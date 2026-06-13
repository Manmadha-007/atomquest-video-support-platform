import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_FILE_STORAGE_DIR = path.resolve("uploads", "files");

function getStorageRoot(): string {
  return path.resolve(process.env.FILE_STORAGE_DIR ?? DEFAULT_FILE_STORAGE_DIR);
}

function assertSafeSegment(value: string, fieldName: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`${fieldName} contains unsupported characters.`);
  }

  return value;
}

function assertSafeExtension(value: string): string {
  if (!/^[a-z0-9]+$/.test(value)) {
    throw new Error("extension contains unsupported characters.");
  }

  return value;
}

export function getFileStorageKey({
  extension,
  fileAttachmentId,
  sessionId,
}: {
  extension: string;
  fileAttachmentId: string;
  sessionId: string;
}): string {
  return path.join(
    assertSafeSegment(sessionId, "sessionId"),
    `${assertSafeSegment(fileAttachmentId, "fileAttachmentId")}.${assertSafeExtension(extension)}`,
  );
}

export function resolveFileStoragePath(storageKey: string): string {
  const storageRoot = getStorageRoot();
  const resolvedPath = path.resolve(storageRoot, storageKey);
  const expectedPrefix = `${storageRoot}${path.sep}`;

  if (!resolvedPath.startsWith(expectedPrefix)) {
    throw new Error("File storage path is outside the configured root.");
  }

  return resolvedPath;
}

export async function writeUploadedFile(
  storageKey: string,
  fileBuffer: Buffer,
): Promise<number> {
  const filePath = resolveFileStoragePath(storageKey);

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, fileBuffer, { flag: "wx" });

  const result = await stat(filePath);
  return result.size;
}

export async function removeUploadedFile(storageKey: string): Promise<void> {
  await rm(resolveFileStoragePath(storageKey), { force: true });
}
