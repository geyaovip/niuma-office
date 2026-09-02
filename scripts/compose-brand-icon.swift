#!/usr/bin/env swift

import AppKit
import Foundation

enum IconError: LocalizedError {
    case usage
    case input
    case output

    var errorDescription: String? {
        switch self {
        case .usage: return "用法：compose-brand-icon.swift <透明牛头 PNG> <输出 PNG>"
        case .input: return "无法读取透明牛头 PNG"
        case .output: return "无法写出应用图标 PNG"
        }
    }
}

func run() throws {
    guard CommandLine.arguments.count == 3 else { throw IconError.usage }
    let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
    let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
    guard let mascot = NSImage(contentsOf: inputURL) else { throw IconError.input }

    let canvas = NSSize(width: 1024, height: 1024)
    let image = NSImage(size: canvas)
    image.lockFocus()

    NSGraphicsContext.current?.imageInterpolation = .high
    let plate = NSBezierPath(
        roundedRect: NSRect(x: 36, y: 36, width: 952, height: 952),
        xRadius: 215,
        yRadius: 215
    )
    let gradient = NSGradient(
        starting: NSColor(calibratedRed: 0.19, green: 0.18, blue: 0.17, alpha: 1),
        ending: NSColor(calibratedRed: 0.11, green: 0.10, blue: 0.095, alpha: 1)
    )
    gradient?.draw(in: plate, angle: -90)

    let sourceSize = mascot.size
    let maxWidth: CGFloat = 870
    let maxHeight: CGFloat = 850
    let scale = min(maxWidth / sourceSize.width, maxHeight / sourceSize.height)
    let targetSize = NSSize(width: sourceSize.width * scale, height: sourceSize.height * scale)
    let targetRect = NSRect(
        x: (canvas.width - targetSize.width) / 2,
        y: 93,
        width: targetSize.width,
        height: targetSize.height
    )
    mascot.draw(
        in: targetRect,
        from: NSRect(origin: .zero, size: sourceSize),
        operation: .sourceOver,
        fraction: 1
    )
    image.unlockFocus()

    guard
        let tiff = image.tiffRepresentation,
        let bitmap = NSBitmapImageRep(data: tiff),
        let png = bitmap.representation(using: .png, properties: [:])
    else { throw IconError.output }
    try png.write(to: outputURL, options: .atomic)
}

do {
    try run()
} catch {
    FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
    exit(1)
}
