#!/usr/bin/env swift

import AppKit
import CoreImage
import CoreVideo
import Foundation
import Vision

enum ExtractionError: LocalizedError {
    case usage
    case noImage
    case noObservation
    case noForeground
    case outputFailed

    var errorDescription: String? {
        switch self {
        case .usage:
            return "用法：extract-brand-mascot.swift <输入图片> <输出 PNG>"
        case .noImage:
            return "无法读取输入图片"
        case .noObservation:
            return "未能生成前景分割结果"
        case .noForeground:
            return "没有识别到可提取的前景主体"
        case .outputFailed:
            return "无法写出透明 PNG"
        }
    }
}

struct InstanceMetrics {
    let label: Int
    let bounds: CGRect
}

func largestInstance(in mask: CVPixelBuffer) throws -> InstanceMetrics {
    CVPixelBufferLockBaseAddress(mask, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(mask, .readOnly) }

    guard let baseAddress = CVPixelBufferGetBaseAddress(mask) else {
        throw ExtractionError.noForeground
    }

    let width = CVPixelBufferGetWidth(mask)
    let height = CVPixelBufferGetHeight(mask)
    let bytesPerRow = CVPixelBufferGetBytesPerRow(mask)
    var counts: [Int: Int] = [:]
    var bounds: [Int: (minX: Int, minY: Int, maxX: Int, maxY: Int)] = [:]

    for row in 0..<height {
        let pixels = baseAddress.advanced(by: row * bytesPerRow).assumingMemoryBound(to: UInt8.self)
        for column in 0..<width {
            let label = Int(pixels[column])
            if label != 0 {
                counts[label, default: 0] += 1
                let current = bounds[label] ?? (column, row, column, row)
                bounds[label] = (
                    min(current.minX, column),
                    min(current.minY, row),
                    max(current.maxX, column),
                    max(current.maxY, row)
                )
            }
        }
    }

    guard
        let label = counts.max(by: { $0.value < $1.value })?.key,
        let resultBounds = bounds[label]
    else {
        throw ExtractionError.noForeground
    }
    return InstanceMetrics(
        label: label,
        bounds: CGRect(
            x: resultBounds.minX,
            y: resultBounds.minY,
            width: resultBounds.maxX - resultBounds.minX + 1,
            height: resultBounds.maxY - resultBounds.minY + 1
        )
    )
}

func squareCrop(for metrics: InstanceMetrics, mask: CVPixelBuffer, imageExtent: CGRect) -> CGRect {
    let maskWidth = CGFloat(CVPixelBufferGetWidth(mask))
    let maskHeight = CGFloat(CVPixelBufferGetHeight(mask))
    let scaleX = imageExtent.width / maskWidth
    let scaleY = imageExtent.height / maskHeight
    let subjectWidth = metrics.bounds.width * scaleX
    let subjectHeight = metrics.bounds.height * scaleY
    let subjectCenterX = imageExtent.minX + metrics.bounds.midX * scaleX
    let subjectTop = metrics.bounds.minY * scaleY
    let subjectCenterY = imageExtent.maxY - subjectTop - subjectHeight / 2
    let side = min(max(subjectWidth, subjectHeight) * 1.12, min(imageExtent.width, imageExtent.height))

    let proposed = CGRect(
        x: subjectCenterX - side / 2,
        y: subjectCenterY - side / 2,
        width: side,
        height: side
    )
    let x = min(max(proposed.minX, imageExtent.minX), imageExtent.maxX - side)
    let y = min(max(proposed.minY, imageExtent.minY), imageExtent.maxY - side)
    return CGRect(x: x, y: y, width: side, height: side).integral
}

func run() throws {
    guard CommandLine.arguments.count == 3 else { throw ExtractionError.usage }

    let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
    let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
    guard let inputImage = CIImage(contentsOf: inputURL) else { throw ExtractionError.noImage }

    let request = VNGenerateForegroundInstanceMaskRequest()
    let handler = VNImageRequestHandler(url: inputURL)
    try handler.perform([request])
    guard let observation = request.results?.first else { throw ExtractionError.noObservation }

    let metrics = try largestInstance(in: observation.instanceMask)
    let maskBuffer = try observation.generateScaledMaskForImage(
        forInstances: IndexSet(integer: metrics.label),
        from: handler
    )

    let rawMask = CIImage(cvPixelBuffer: maskBuffer)
    let openedMask = rawMask
        .applyingFilter("CIMorphologyMinimum", parameters: [kCIInputRadiusKey: 10.0])
        .applyingFilter("CIMorphologyMaximum", parameters: [kCIInputRadiusKey: 8.0])
        .applyingFilter("CIColorControls", parameters: [
            kCIInputContrastKey: 1.35,
            kCIInputBrightnessKey: -0.03,
        ])
        .cropped(to: inputImage.extent)
    let transparent = CIImage(color: .clear).cropped(to: inputImage.extent)
    guard let compositedImage = CIFilter(
        name: "CIBlendWithMask",
        parameters: [
            kCIInputImageKey: inputImage,
            kCIInputBackgroundImageKey: transparent,
            kCIInputMaskImageKey: openedMask,
        ]
    )?.outputImage else {
        throw ExtractionError.outputFailed
    }

    let crop = squareCrop(for: metrics, mask: observation.instanceMask, imageExtent: inputImage.extent)
    let outputImage = compositedImage
        .cropped(to: crop)
        .transformed(by: CGAffineTransform(translationX: -crop.minX, y: -crop.minY))

    let context = CIContext(options: [.useSoftwareRenderer: false])
    guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) else {
        throw ExtractionError.outputFailed
    }
    try context.writePNGRepresentation(
        of: outputImage,
        to: outputURL,
        format: .RGBA8,
        colorSpace: colorSpace
    )
}

do {
    try run()
} catch {
    FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
    exit(1)
}
