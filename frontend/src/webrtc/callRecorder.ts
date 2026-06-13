const RECORDING_WIDTH = 1280;
const RECORDING_HEIGHT = 720;
const RECORDING_FRAME_RATE = 30;
const RECORDING_CHUNK_INTERVAL_MS = 5_000;
const LOCAL_PIP_WIDTH = 320;
const LOCAL_PIP_HEIGHT = 180;
const LOCAL_PIP_MARGIN = 28;

const SUPPORTED_MIME_TYPES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

interface AtomQuestCallRecorderOptions {
  localStream: MediaStream;
  remoteStream: MediaStream;
  onChunk: (chunk: Blob, sequence: number) => Promise<void>;
}

function getLiveVideoTrack(stream: MediaStream): MediaStreamTrack | undefined {
  return stream
    .getVideoTracks()
    .find((track) => track.readyState === "live" && track.enabled);
}

function createStreamVideo(stream: MediaStream, muted: boolean): HTMLVideoElement {
  const video = document.createElement("video");
  video.autoplay = true;
  video.muted = muted;
  video.playsInline = true;
  video.srcObject = stream;
  return video;
}

function drawVideoCover(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    return;
  }

  const sourceRatio = video.videoWidth / video.videoHeight;
  const targetRatio = width / height;
  let sourceWidth = video.videoWidth;
  let sourceHeight = video.videoHeight;
  let sourceX = 0;
  let sourceY = 0;

  if (sourceRatio > targetRatio) {
    sourceWidth = video.videoHeight * targetRatio;
    sourceX = (video.videoWidth - sourceWidth) / 2;
  } else {
    sourceHeight = video.videoWidth / targetRatio;
    sourceY = (video.videoHeight - sourceHeight) / 2;
  }

  context.drawImage(
    video,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    x,
    y,
    width,
    height,
  );
}

function drawPlaceholder(
  context: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  context.fillStyle = "#18181b";
  context.fillRect(x, y, width, height);
  context.fillStyle = "#a1a1aa";
  context.font = "600 24px Inter, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, x + width / 2, y + height / 2);
}

export function getSupportedRecordingMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") {
    return null;
  }

  return (
    SUPPORTED_MIME_TYPES.find((mimeType) =>
      MediaRecorder.isTypeSupported(mimeType),
    ) ?? null
  );
}

export class AtomQuestCallRecorder {
  public readonly mimeType: string;

  private readonly options: AtomQuestCallRecorderOptions;
  private readonly canvas = document.createElement("canvas");
  private readonly localVideo: HTMLVideoElement;
  private readonly remoteVideo: HTMLVideoElement;
  private readonly pendingUploads = new Set<Promise<void>>();
  private audioContext: AudioContext | null = null;
  private compositeStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private animationFrameId: number | null = null;
  private nextSequence = 0;
  private uploadError: Error | null = null;
  private stopPromise: Promise<void> | null = null;

  public constructor(options: AtomQuestCallRecorderOptions) {
    const mimeType = getSupportedRecordingMimeType();

    if (!mimeType) {
      throw new Error("Call recording is not supported by this browser.");
    }

    this.options = options;
    this.mimeType = mimeType;
    this.canvas.width = RECORDING_WIDTH;
    this.canvas.height = RECORDING_HEIGHT;
    this.localVideo = createStreamVideo(options.localStream, true);
    this.remoteVideo = createStreamVideo(options.remoteStream, true);
  }

  public get active(): boolean {
    return this.mediaRecorder?.state === "recording";
  }

  public async start(): Promise<void> {
    if (this.mediaRecorder) {
      throw new Error("Call recorder has already been started.");
    }

    await Promise.allSettled([this.localVideo.play(), this.remoteVideo.play()]);

    const context = this.canvas.getContext("2d");

    if (!context || typeof this.canvas.captureStream !== "function") {
      throw new Error("Canvas recording is not supported by this browser.");
    }

    const canvasStream = this.canvas.captureStream(RECORDING_FRAME_RATE);
    const recordingTracks = [...canvasStream.getVideoTracks()];
    const audioTracks = await this.createMixedAudioTracks();

    recordingTracks.push(...audioTracks);
    this.compositeStream = new MediaStream(recordingTracks);
    this.mediaRecorder = new MediaRecorder(this.compositeStream, {
      mimeType: this.mimeType,
      videoBitsPerSecond: 2_500_000,
      audioBitsPerSecond: 128_000,
    });
    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size === 0) {
        return;
      }

      const sequence = this.nextSequence;
      this.nextSequence += 1;
      const upload = this.options
        .onChunk(event.data, sequence)
        .catch((error: unknown) => {
          this.uploadError =
            error instanceof Error
              ? error
              : new Error("Recording chunk upload failed.");
          throw this.uploadError;
        })
        .finally(() => {
          this.pendingUploads.delete(upload);
        });

      this.pendingUploads.add(upload);
    };
    this.mediaRecorder.onerror = () => {
      this.uploadError = new Error("The browser media recorder failed.");
    };

    this.drawFrame(context);
    this.mediaRecorder.start(RECORDING_CHUNK_INTERVAL_MS);
  }

  public async stop(): Promise<void> {
    if (this.stopPromise) {
      return this.stopPromise;
    }

    this.stopPromise = this.stopInternal();
    return this.stopPromise;
  }

  private async createMixedAudioTracks(): Promise<MediaStreamTrack[]> {
    const streamsWithAudio = [
      this.options.localStream,
      this.options.remoteStream,
    ].filter((stream) => stream.getAudioTracks().length > 0);

    if (streamsWithAudio.length === 0) {
      return [];
    }

    this.audioContext = new AudioContext();
    await this.audioContext.resume();
    const destination = this.audioContext.createMediaStreamDestination();

    for (const stream of streamsWithAudio) {
      this.audioContext.createMediaStreamSource(stream).connect(destination);
    }

    return destination.stream.getAudioTracks();
  }

  private drawFrame(context: CanvasRenderingContext2D): void {
    context.fillStyle = "#09090b";
    context.fillRect(0, 0, RECORDING_WIDTH, RECORDING_HEIGHT);

    if (getLiveVideoTrack(this.options.remoteStream)) {
      drawVideoCover(
        context,
        this.remoteVideo,
        0,
        0,
        RECORDING_WIDTH,
        RECORDING_HEIGHT,
      );
    } else {
      drawPlaceholder(
        context,
        "Customer camera off",
        0,
        0,
        RECORDING_WIDTH,
        RECORDING_HEIGHT,
      );
    }

    const pipX = RECORDING_WIDTH - LOCAL_PIP_WIDTH - LOCAL_PIP_MARGIN;
    const pipY = RECORDING_HEIGHT - LOCAL_PIP_HEIGHT - LOCAL_PIP_MARGIN;

    context.fillStyle = "rgba(0, 0, 0, 0.35)";
    context.fillRect(
      pipX - 4,
      pipY - 4,
      LOCAL_PIP_WIDTH + 8,
      LOCAL_PIP_HEIGHT + 8,
    );

    if (getLiveVideoTrack(this.options.localStream)) {
      context.save();
      context.translate(pipX + LOCAL_PIP_WIDTH, pipY);
      context.scale(-1, 1);
      drawVideoCover(
        context,
        this.localVideo,
        0,
        0,
        LOCAL_PIP_WIDTH,
        LOCAL_PIP_HEIGHT,
      );
      context.restore();
    } else {
      drawPlaceholder(
        context,
        "Agent camera off",
        pipX,
        pipY,
        LOCAL_PIP_WIDTH,
        LOCAL_PIP_HEIGHT,
      );
    }

    this.animationFrameId = window.requestAnimationFrame(() => {
      this.drawFrame(context);
    });
  }

  private async stopInternal(): Promise<void> {
    const recorder = this.mediaRecorder;

    if (recorder?.state === "recording") {
      await new Promise<void>((resolve) => {
        recorder.addEventListener("stop", () => resolve(), { once: true });
        recorder.stop();
      });
    }

    await Promise.allSettled(Array.from(this.pendingUploads));
    this.cleanup();

    if (this.uploadError) {
      throw this.uploadError;
    }
  }

  private cleanup(): void {
    if (this.animationFrameId !== null) {
      window.cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    for (const track of this.compositeStream?.getTracks() ?? []) {
      track.stop();
    }

    this.compositeStream = null;
    this.localVideo.srcObject = null;
    this.remoteVideo.srcObject = null;
    void this.audioContext?.close();
    this.audioContext = null;
  }
}
