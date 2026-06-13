import { io } from "socket.io-client";

const socket = io("http://localhost:5000");

socket.on("connect", () => {
  console.log("CUSTOMER CONNECTED:", socket.id);

  socket.emit(
    "session:join",
    {
      sessionId: "cmqc1aljq00058oumfv1mybzo",
      participantId: "cmqc1auxv00078oumsu3124dv",
      role: "CUSTOMER",
    },
    (response) => {
      console.log("CUSTOMER ACK:", response);
    }
  );
});

socket.on("session:joined", console.log);
socket.on("participant:update", console.log);
socket.on("session:left", console.log);