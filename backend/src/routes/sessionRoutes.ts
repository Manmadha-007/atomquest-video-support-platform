import { Router } from "express";

import {
  createSession,
  endSession,
  getSessionById,
  getSessionInvite,
  getSessionMessages,
  getSessions,
  joinSession,
} from "../controllers/sessionController.js";

const router = Router();

router.post("/", createSession);
router.post("/join", joinSession);
router.get("/invites/:token", getSessionInvite);
router.post("/:sessionId/end", endSession);
router.get("/", getSessions);
router.get("/:sessionId/messages", getSessionMessages);
router.get("/:sessionId", getSessionById);

export default router;
