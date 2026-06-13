import {
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const DEFAULT_RECORDING_STORAGE_DIR = path.resolve("storage", "recordings");
const CHUNK_DIRECTORY_NAME = ".chunks";
const CHUNK_FILE_EXTENSION = ".part";
const QUIET_PERIOD_MS = 1_000;
const MAX_QUIET_WAIT_MS = 10_000;

function getStorageRoot(): string {
  return path.resolve(
    process.env.RECORDING_STORAGE_DIR ?? DEFAULT_RECORDING_STORAGE_DIR,
  );
}

function assertSafeSegment(value: string, fieldName: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`${fieldName} contains unsupported characters.`);
  }

  return value;
}

function getChunkDirectory(recordingId: string): string {
  return path.join(
    getStorageRoot(),
    CHUNK_DIRECTORY_NAME,
    assertSafeSegment(recordingId, "recordingId"),
  );
}

function getChunkPath(recordingId: string, sequence: number): string {
  return path.join(
    getChunkDirectory(recordingId),
    `${sequence.toString().padStart(8, "0")}${CHUNK_FILE_EXTENSION}`,
  );
}

function getFinalStorageKey(recordingId: string): string {
  return `${assertSafeSegment(recordingId, "recordingId")}.webm`;
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

async function getChunkSignature(recordingId: string): Promise<string> {
  const directory = getChunkDirectory(recordingId);

  try {
    const entries = (await readdir(directory))
      .filter((entry) => entry.endsWith(CHUNK_FILE_EXTENSION))
      .sort();
    const details = await Promise.all(
      entries.map(async (entry) => {
        const info = await stat(path.join(directory, entry));
        return `${entry}:${info.size}:${info.mtimeMs}`;
      }),
    );

    return details.join("|");
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return "";
    }

    throw error;
  }
}

async function waitForChunkWritesToSettle(recordingId: string): Promise<void> {
  const startedAt = Date.now();
  let stableSince = startedAt;
  let previousSignature = await getChunkSignature(recordingId);

  while (Date.now() - startedAt < MAX_QUIET_WAIT_MS) {
    await delay(250);
    const signature = await getChunkSignature(recordingId);

    if (signature !== previousSignature) {
      previousSignature = signature;
      stableSince = Date.now();
      continue;
    }

    if (Date.now() - stableSince >= QUIET_PERIOD_MS) {
      return;
    }
  }
}

export async function writeRecordingChunk(
  recordingId: string,
  sequence: number,
  chunk: Buffer,
): Promise<void> {
  const directory = getChunkDirectory(recordingId);
  const chunkPath = getChunkPath(recordingId, sequence);

  await mkdir(directory, { recursive: true });
  await writeFile(chunkPath, chunk, { flag: "wx" }).catch((error: unknown) => {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "EEXIST"
    ) {
      return;
    }

    throw error;
  });
}

export async function finalizeRecordingStorage(recordingId: string): Promise<{
  sizeBytes: number;
  storageKey: string;
}> {
  await waitForChunkWritesToSettle(recordingId);

  const storageRoot = getStorageRoot();
  const chunkDirectory = getChunkDirectory(recordingId);
  const chunkNames = (await readdir(chunkDirectory))
    .filter((entry) => entry.endsWith(CHUNK_FILE_EXTENSION))
    .sort();

  if (chunkNames.length === 0) {
    throw new Error("No recording media chunks were uploaded.");
  }

  await mkdir(storageRoot, { recursive: true });

  const storageKey = getFinalStorageKey(recordingId);
  const finalPath = path.join(storageRoot, storageKey);
  const temporaryPath = `${finalPath}.tmp`;

  await writeFile(temporaryPath, Buffer.alloc(0));
  const output = await open(temporaryPath, "a");

  try {
    for (const chunkName of chunkNames) {
      const chunk = await readFile(path.join(chunkDirectory, chunkName));
      await output.write(chunk);
    }
  } finally {
    await output.close();
  }

  await rename(temporaryPath, finalPath);
  const result = await stat(finalPath);
  await rm(chunkDirectory, { recursive: true, force: true });

  return {
    sizeBytes: result.size,
    storageKey,
  };
}

export function resolveRecordingStoragePath(storageKey: string): string {
  const storageRoot = getStorageRoot();
  const resolvedPath = path.resolve(storageRoot, storageKey);
  const expectedPrefix = `${storageRoot}${path.sep}`;

  if (!resolvedPath.startsWith(expectedPrefix)) {
    throw new Error("Recording storage path is outside the configured root.");
  }

  return resolvedPath;
}
