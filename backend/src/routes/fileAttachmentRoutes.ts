import express, { Router } from "express";

import {
  downloadFile,
  getFileAttachments,
  handleRawBodyError,
  uploadFile,
} from "../controllers/fileAttachmentController.js";
import { MAX_FILE_UPLOAD_SIZE_BYTES } from "../services/fileAttachmentService.js";

const router = Router();

router.post(
  "/upload",
  express.raw({
    limit: MAX_FILE_UPLOAD_SIZE_BYTES,
    type: () => true,
  }),
  handleRawBodyError,
  uploadFile,
);
router.get("/", getFileAttachments);
router.get("/:fileId/download", downloadFile);

export default router;
