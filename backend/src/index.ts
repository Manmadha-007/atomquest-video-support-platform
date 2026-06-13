import express, { Request, Response } from "express";
import cors from "cors";
import { createServer } from "node:http";

import sessionRoutes from "./routes/sessionRoutes.js";
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

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
