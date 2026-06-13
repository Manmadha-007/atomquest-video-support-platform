import {
  DEFAULT_MEDIA_CONSTRAINTS,
  requestCameraMicrophone,
  stopMediaStream,
} from "./mediaTransport";

export type DeviceAccessStatus =
  | "requesting"
  | "granted"
  | "denied"
  | "unavailable";

export interface DeviceAccessResult {
  status: Exclude<DeviceAccessStatus, "requesting">;
  message: string | null;
}

export interface PreJoinMediaResult {
  stream: MediaStream;
  camera: DeviceAccessResult;
  microphone: DeviceAccessResult;
}

interface PreJoinMediaEntry {
  promise: Promise<PreJoinMediaResult>;
  result: PreJoinMediaResult | null;
  releaseTimer: number | null;
}

interface CallMediaHandoff {
  stream: MediaStream;
  expiryTimer: number;
}

const RELEASE_DELAY_MS = 300;
const HANDOFF_EXPIRY_MS = 30_000;
const preJoinEntries = new Map<string, PreJoinMediaEntry>();
const callMediaHandoffs = new Map<string, CallMediaHandoff>();

function classifyDeviceError(error: unknown): DeviceAccessResult {
  if (error instanceof DOMException) {
    if (
      error.name === "NotAllowedError" ||
      error.name === "PermissionDeniedError"
    ) {
      return {
        status: "denied",
        message: "Permission was denied in the browser.",
      };
    }

    if (
      error.name === "NotFoundError" ||
      error.name === "DevicesNotFoundError"
    ) {
      return {
        status: "unavailable",
        message: "No compatible device was found.",
      };
    }

    if (
      error.name === "NotReadableError" ||
      error.name === "TrackStartError"
    ) {
      return {
        status: "unavailable",
        message: "The device is unavailable or already in use.",
      };
    }

    if (error.name === "OverconstrainedError") {
      return {
        status: "unavailable",
        message: "The device cannot satisfy the requested settings.",
      };
    }
  }

  return {
    status: "unavailable",
    message:
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : "The device could not be started.",
  };
}

async function requestCameraTrack(): Promise<{
  track: MediaStreamTrack | null;
  access: DeviceAccessResult;
}> {
  try {
    const stream = await requestCameraMicrophone({
      audio: false,
      video: DEFAULT_MEDIA_CONSTRAINTS.video,
    });
    const track = stream.getVideoTracks()[0] ?? null;

    if (!track) {
      stopMediaStream(stream);
      return {
        track: null,
        access: {
          status: "unavailable",
          message: "No camera track was returned.",
        },
      };
    }

    return {
      track,
      access: {
        status: "granted",
        message: null,
      },
    };
  } catch (error) {
    return {
      track: null,
      access: classifyDeviceError(error),
    };
  }
}

async function requestMicrophoneTrack(): Promise<{
  track: MediaStreamTrack | null;
  access: DeviceAccessResult;
}> {
  try {
    const stream = await requestCameraMicrophone({
      audio: true,
      video: false,
    });
    const track = stream.getAudioTracks()[0] ?? null;

    if (!track) {
      stopMediaStream(stream);
      return {
        track: null,
        access: {
          status: "unavailable",
          message: "No microphone track was returned.",
        },
      };
    }

    return {
      track,
      access: {
        status: "granted",
        message: null,
      },
    };
  } catch (error) {
    return {
      track: null,
      access: classifyDeviceError(error),
    };
  }
}

async function acquirePreJoinMedia(): Promise<PreJoinMediaResult> {
  const [camera, microphone] = await Promise.all([
    requestCameraTrack(),
    requestMicrophoneTrack(),
  ]);
  const tracks = [camera.track, microphone.track].filter(
    (track): track is MediaStreamTrack => track !== null,
  );

  return {
    stream: new MediaStream(tracks),
    camera: camera.access,
    microphone: microphone.access,
  };
}

export function retainPreJoinMedia(
  key: string,
): Promise<PreJoinMediaResult> {
  const existingEntry = preJoinEntries.get(key);

  if (existingEntry) {
    if (existingEntry.releaseTimer !== null) {
      window.clearTimeout(existingEntry.releaseTimer);
      existingEntry.releaseTimer = null;
    }

    return existingEntry.promise;
  }

  const entry: PreJoinMediaEntry = {
    promise: Promise.resolve({
      stream: new MediaStream(),
      camera: {
        status: "unavailable",
        message: "Camera access has not started.",
      },
      microphone: {
        status: "unavailable",
        message: "Microphone access has not started.",
      },
    }),
    result: null,
    releaseTimer: null,
  };

  entry.promise = acquirePreJoinMedia().then((result) => {
    entry.result = result;
    return result;
  });
  preJoinEntries.set(key, entry);

  return entry.promise;
}

export function releasePreJoinMedia(key: string): void {
  const entry = preJoinEntries.get(key);

  if (!entry || entry.releaseTimer !== null) {
    return;
  }

  entry.releaseTimer = window.setTimeout(() => {
    const latestEntry = preJoinEntries.get(key);

    if (latestEntry !== entry) {
      return;
    }

    if (entry.result) {
      stopMediaStream(entry.result.stream);
    } else {
      void entry.promise.then((result) => {
        stopMediaStream(result.stream);
      });
    }

    preJoinEntries.delete(key);
  }, RELEASE_DELAY_MS);
}

export async function retryPreJoinMedia(
  key: string,
): Promise<PreJoinMediaResult> {
  const entry = preJoinEntries.get(key);

  if (entry?.releaseTimer !== null && entry?.releaseTimer !== undefined) {
    window.clearTimeout(entry.releaseTimer);
  }

  if (entry?.result) {
    stopMediaStream(entry.result.stream);
  } else if (entry) {
    void entry.promise.then((result) => {
      stopMediaStream(result.stream);
    });
  }

  preJoinEntries.delete(key);
  return retainPreJoinMedia(key);
}

export async function transferPreJoinMediaToCall(
  preJoinKey: string,
  callKey: string,
): Promise<MediaStream> {
  const entry = preJoinEntries.get(preJoinKey);
  const result = entry
    ? await entry.promise
    : await retainPreJoinMedia(preJoinKey);
  const existingHandoff = callMediaHandoffs.get(callKey);

  if (existingHandoff) {
    window.clearTimeout(existingHandoff.expiryTimer);
    stopMediaStream(existingHandoff.stream);
  }

  if (entry?.releaseTimer !== null && entry?.releaseTimer !== undefined) {
    window.clearTimeout(entry.releaseTimer);
  }

  preJoinEntries.delete(preJoinKey);

  const expiryTimer = window.setTimeout(() => {
    const handoff = callMediaHandoffs.get(callKey);

    if (!handoff || handoff.stream !== result.stream) {
      return;
    }

    stopMediaStream(handoff.stream);
    callMediaHandoffs.delete(callKey);
  }, HANDOFF_EXPIRY_MS);

  callMediaHandoffs.set(callKey, {
    stream: result.stream,
    expiryTimer,
  });

  return result.stream;
}

export function takePreJoinMediaForCall(
  callKey: string,
): MediaStream | null {
  const handoff = callMediaHandoffs.get(callKey);

  if (!handoff) {
    return null;
  }

  window.clearTimeout(handoff.expiryTimer);
  callMediaHandoffs.delete(callKey);
  return handoff.stream;
}

export function getCallMediaKey(
  sessionId: string,
  participantId: string,
): string {
  return `${sessionId}:${participantId}`;
}
