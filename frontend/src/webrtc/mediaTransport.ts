export const DEFAULT_MEDIA_CONSTRAINTS: MediaStreamConstraints = {
  audio: true,
  video: {
    width: {
      ideal: 1280,
    },
    height: {
      ideal: 720,
    },
    frameRate: {
      ideal: 30,
    },
  },
};

export async function requestCameraMicrophone(
  constraints: MediaStreamConstraints = DEFAULT_MEDIA_CONSTRAINTS,
): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera and microphone access is not available.");
  }

  return navigator.mediaDevices.getUserMedia(constraints);
}

export function addLocalTracksToPeerConnection(
  peerConnection: RTCPeerConnection,
  stream: MediaStream,
): RTCRtpSender[] {
  const existingTrackIds = new Set(
    peerConnection
      .getSenders()
      .map((sender) => sender.track?.id)
      .filter((trackId): trackId is string => Boolean(trackId)),
  );
  const senders: RTCRtpSender[] = [];

  for (const track of stream.getTracks()) {
    if (existingTrackIds.has(track.id)) {
      continue;
    }

    senders.push(peerConnection.addTrack(track, stream));
    existingTrackIds.add(track.id);
  }

  return senders;
}

export function addRemoteTrackToStream(
  remoteStream: MediaStream,
  event: RTCTrackEvent,
): MediaStream {
  if (!remoteStream.getTracks().some((track) => track.id === event.track.id)) {
    remoteStream.addTrack(event.track);
  }

  return remoteStream;
}

export function stopMediaStream(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) {
    track.stop();
  }
}
