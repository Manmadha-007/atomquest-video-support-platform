import express, { Request, Response } from "express";
import cors from "cors";
import { createServer } from "node:http";

import sessionRoutes from "./routes/sessionRoutes.js";
import recordingRoutes from "./routes/recordingRoutes.js";
import fileAttachmentRoutes from "./routes/fileAttachmentRoutes.js";
import { recoverInterruptedRecordings } from "./services/recordingService.js";
import { initializeSocketServer } from "./sockets/socketServer.js";

const app = express();
const httpServer = createServer(app);

app.use(cors());
app.use(express.json());

app.get("/", (_req: Request, res: Response) => {
  res.json({
    message: "AtomQuest Backend Running",
  });
});

app.use("/api/sessions", sessionRoutes);
app.use("/api/recordings", recordingRoutes);
app.use("/api/files", fileAttachmentRoutes);

app.use((_req: Request, res: Response) => {
  res.status(404).json({
    error: {
      code: "ROUTE_NOT_FOUND",
      message: "Route not found.",
      category: "VALIDATION_ERROR",
    },
  });
});

const PORT = 5000;

initializeSocketServer(httpServer);
void recoverInterruptedRecordings().catch((error) => {
  console.error(
    JSON.stringify({
      level: "error",
      event: "recording.recovery_failed",
      message: error instanceof Error ? error.message : "Unknown error",
    }),
  );
});

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
