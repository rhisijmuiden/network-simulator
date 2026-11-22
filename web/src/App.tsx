import { useState } from "react";
import { Navigate, Outlet, Route, Routes, useLocation, useMatch } from "react-router";
import { useAuth } from "./auth";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { Spinner } from "./components/ui";
import Audit from "./pages/admin/Audit";
import Backup from "./pages/admin/Backup";
import MailSettings from "./pages/admin/Mail";
import Updates from "./pages/admin/Updates";
import Users from "./pages/admin/Users";
import LessonDetail from "./pages/lessons/Detail";
import LessonList from "./pages/lessons/List";
import LessonProgress from "./pages/lessons/Progress";
import ScenarioEditor from "./pages/lessons/ScenarioEditor";
import Dashboard from "./pages/Dashboard";
import ConsoleHelp from "./pages/lab/ConsoleHelp";
import DeviceLibrary from "./pages/lab/Devices";
import ForcePasswordChange from "./pages/ForcePasswordChange";
import Login from "./pages/Login";
import Profile from "./pages/Profile";
import TopologyEditor from "./pages/topologies/Editor";
import TopologyList from "./pages/topologies/List";

function Shell() {
  const [open, setOpen] = useState(false);
  // The topology editor uses the whole area next to the menu.
  const fullBleed = useMatch("/topologies/:id");
  return (
    <div className="flex h-full">
      <Sidebar open={open} onNavigate={() => setOpen(false)} />
      {open && <div className="fixed inset-0 z-30 bg-nacht/50 md:hidden" onClick={() => setOpen(false)} />}
      <div className={`flex min-w-0 flex-1 flex-col ${fullBleed ? "overflow-hidden" : "overflow-y-auto"}`}>
        <Topbar onMenu={() => setOpen(true)} />
        {fullBleed ? (
          <main className="min-h-0 flex-1">
            <Outlet />
          </main>
        ) : (
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8 md:py-8">
            <Outlet />
          </main>
        )}
      </div>
    </div>
  );
}

function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.mustChangePassword) return <ForcePasswordChange />;
  return <Outlet />;
}

function RequireAdmin() {
  const { user } = useAuth();
  return user?.role === "admin" ? <Outlet /> : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuth />}>
        <Route element={<Shell />}>
          <Route index element={<Dashboard />} />
          <Route path="topologies" element={<TopologyList />} />
          <Route path="topologies/:id" element={<TopologyEditor />} />
          <Route path="devices" element={<DeviceLibrary />} />
          <Route path="console" element={<ConsoleHelp />} />
          <Route path="lessons" element={<LessonList />} />
          <Route path="lessons/new" element={<ScenarioEditor />} />
          <Route path="lessons/edit/:id" element={<ScenarioEditor />} />
          <Route path="lessons/progress" element={<LessonProgress />} />
          <Route path="lessons/:key" element={<LessonDetail />} />
          <Route path="profile" element={<Profile />} />
          <Route path="admin" element={<RequireAdmin />}>
            <Route path="users" element={<Users />} />
            <Route path="mail" element={<MailSettings />} />
            <Route path="backup" element={<Backup />} />
            <Route path="updates" element={<Updates />} />
            <Route path="audit" element={<Audit />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
