import { Router } from "express";

import {
  createSession,
  endSession,
  getSessionById,
  getSessions,
  joinSession,
} from "../controllers/sessionController.js";

const router = Router();

router.post("/", createSession);
router.post("/join", joinSession);
router.post("/:sessionId/end", endSession);
router.get("/", getSessions);
router.get("/:sessionId", getSessionById);

export default router;
