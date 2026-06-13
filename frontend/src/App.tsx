import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import AgentDashboard from "./pages/AgentDashboard";
import OperationsDashboard from "./pages/OperationsDashboard";
import PreJoinPage from "./pages/PreJoinPage";
import VideoCallPage from "./pages/VideoCallPage";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Navigate replace to="/agent" />} path="/" />
        <Route element={<AgentDashboard />} path="/agent" />
        <Route element={<OperationsDashboard />} path="/operations" />
        <Route element={<PreJoinPage />} path="/join/:token" />
        <Route element={<VideoCallPage />} path="/call" />
        <Route element={<Navigate replace to="/agent" />} path="*" />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
