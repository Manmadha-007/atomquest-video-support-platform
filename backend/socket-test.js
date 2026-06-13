import { io } from "socket.io-client";

const socket = io("http://localhost:5000");

socket.on("connect", () => {
  console.log("CONNECTED:", socket.id);

  socket.emit(
    "session:join",
    {
      sessionId: "cmqc1aljq00058oumfv1mybzo",
      participantId: "cmqc1alju00068oum0nx5nsgr",
      role: "AGENT",
    },
    (response) => {
      console.log("ACK:", response);
    }
  );
});

socket.on("session:joined", (data) => {
  console.log("SESSION_JOINED:", data);
});

socket.on("participant:update", (data) => {
  console.log("PARTICIPANT_UPDATE:", data);
});

socket.on("session:left", (data) => {
  console.log("SESSION_LEFT:", data);
});

socket.on("disconnect", (reason) => {
  console.log("DISCONNECTED:", reason);
});