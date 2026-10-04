import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { PageLoader } from '../components/ui.jsx';

/** OAuth providers redirect here with #token=… in the fragment. */
export default function AuthCallback() {
  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const token = params.get('token');
    const totp = params.get('totp');
    if (totp) {
      /* A 2FA account: the login page asks for the authenticator code. */
      navigate('/login', { replace: true, state: { totpTicket: totp } });
    } else if (token) {
      login(token).then(() => navigate('/account', { replace: true }));
    } else {
      navigate('/login?error=oauth', { replace: true });
    }
  }, []);

  return <PageLoader label="Completing sign in…" />;
}
