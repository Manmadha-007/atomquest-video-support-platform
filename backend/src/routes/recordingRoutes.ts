import { raw, Router } from "express";

import {
  downloadRecording,
  getRecordings,
  startRecording,
  stopRecording,
  uploadRecordingChunk,
} from "../controllers/recordingController.js";

const router = Router();

router.post("/start", startRecording);
router.get("/", getRecordings);
router.get("/:recordingId/download", downloadRecording);
router.post(
  "/:recordingId/chunks/:sequence",
  raw({
    limit: "25mb",
    type: "application/octet-stream",
  }),
  uploadRecordingChunk,
);
router.post("/:recordingId/stop", stopRecording);

export default router;
