import { readFile } from "node:fs/promises";
import type { StoredArtifact, WorkspaceRepository } from "./workspace-repository.js";

export type ArtifactPreview =
  | { kind: "text"; name: string; mimeType: string; content: string; size: number }
  | { kind: "image" | "pdf"; name: string; mimeType: string; dataUrl: string; size: number }
  | { kind: "unsupported"; name: string; mimeType: string; size: number };

export class ArtifactService {
  constructor(private readonly workspace: Pick<WorkspaceRepository, "getArtifact">) {}

  async preview(artifactId: string): Promise<ArtifactPreview> {
    const artifact = await this.workspace.getArtifact(artifactId);
    const size = artifact.size ?? 0;
    if (isText(artifact)) {
      if (size > 5 * 1024 * 1024) throw new Error("文件较大，请使用系统应用打开");
      return { kind: "text", name: artifact.name, mimeType: artifact.mimeType, content: await readFile(artifact.path, "utf8"), size };
    }
    if (artifact.mimeType.startsWith("image/")) {
      if (size > 15 * 1024 * 1024) throw new Error("图片较大，请使用系统应用打开");
      const content = await readFile(artifact.path);
      return { kind: "image", name: artifact.name, mimeType: artifact.mimeType, dataUrl: `data:${artifact.mimeType};base64,${content.toString("base64")}`, size };
    }
    if (artifact.mimeType === "application/pdf") {
      if (size > 30 * 1024 * 1024) throw new Error("PDF 较大，请使用系统应用打开");
      const content = await readFile(artifact.path);
      return { kind: "pdf", name: artifact.name, mimeType: artifact.mimeType, dataUrl: `data:application/pdf;base64,${content.toString("base64")}`, size };
    }
    return { kind: "unsupported", name: artifact.name, mimeType: artifact.mimeType, size };
  }

  async path(artifactId: string) { return (await this.workspace.getArtifact(artifactId)).path; }
}

function isText(artifact: StoredArtifact) {
  return artifact.mimeType.startsWith("text/") || artifact.mimeType === "application/json";
}
