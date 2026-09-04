import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Loading } from '../components/UI/States.jsx';

/** Where Google lands the browser after the server has completed the handshake and set the session. */
export function AuthCallback() {
  const { loadSession } = useAuth();
  const navigate = useNavigate();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    loadSession().then((user) => {
      navigate(user ? '/space' : '/signin?error=That%20sign-in%20did%20not%20complete.', { replace: true });
    });
  }, [loadSession, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loading label="Completing sign-in…" />
    </div>
  );
}
