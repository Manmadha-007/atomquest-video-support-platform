import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import AgentDashboard from "./pages/AgentDashboard";
import CustomerJoinPage from "./pages/CustomerJoinPage";
import VideoCallPage from "./pages/VideoCallPage";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AgentDashboard />} path="/" />
        <Route element={<CustomerJoinPage />} path="/join/:token" />
        <Route element={<VideoCallPage />} path="/call" />
        <Route element={<Navigate replace to="/" />} path="*" />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
