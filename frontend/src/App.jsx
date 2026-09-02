import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { AppLayout } from './layouts/AppLayout.jsx';
import { Loading } from './components/UI/States.jsx';

import { Landing } from './pages/Landing.jsx';
import { SignIn } from './pages/SignIn.jsx';
import { SignUp } from './pages/SignUp.jsx';
import { AuthCallback } from './pages/AuthCallback.jsx';
import { PromiseSpace } from './pages/PromiseSpace.jsx';
import { CreatePromise } from './pages/CreatePromise.jsx';
import { PromiseDetail } from './pages/PromiseDetail.jsx';
import { EvidenceVault } from './pages/EvidenceVault.jsx';
import { Analytics } from './pages/Analytics.jsx';
import { Chronicle } from './pages/Chronicle.jsx';
import { Contests } from './pages/Contests.jsx';
import { ContestDetail } from './pages/ContestDetail.jsx';
import { Notifications } from './pages/Notifications.jsx';
import { Profile } from './pages/Profile.jsx';
import { JudgeMode } from './pages/JudgeMode.jsx';
import { NotFound } from './pages/NotFound.jsx';

/** Nothing behind this renders until the session has been checked with the API. */
function RequireAuth({ children }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loading label="Checking your session…" />
      </div>
    );
  }
  if (!isAuthenticated) return <Navigate to="/signin" replace state={{ from: location.pathname }} />;
  return children;
}

function Routing() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/signin" element={<SignIn />} />
      <Route path="/signup" element={<SignUp />} />
      <Route path="/auth/callback" element={<AuthCallback />} />

      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/space" element={<PromiseSpace />} />
        <Route path="/create" element={<CreatePromise />} />
        <Route path="/promises/:id" element={<PromiseDetail />} />
        <Route path="/vault" element={<EvidenceVault />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/chronicle" element={<Chronicle />} />
        <Route path="/contests" element={<Contests />} />
        <Route path="/contests/:id" element={<ContestDetail />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/judge" element={<JudgeMode />} />
        <Route path="*" element={<NotFound />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <Routing />
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
