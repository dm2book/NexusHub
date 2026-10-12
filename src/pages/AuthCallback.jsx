import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { PageLoader } from '../components/ui.jsx';
import { useI18n } from '../lib/i18n.jsx';
import { api, getAccessToken } from '../lib/api.js';

/** OAuth sign-in lands here. The session travels in the httpOnly cookie the
 *  server set, never in the URL: a "#token=…" link signed in whoever opened it
 *  (an attacker's own token mailed to a buyer put their next purchase in the
 *  attacker's account). The cookie is exchanged for an access token here. */
export default function AuthCallback() {
  const { login } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const totp = params.get('totp');
    if (totp) {
      /* A 2FA account: the login page asks for the authenticator code. */
      navigate('/login', { replace: true, state: { totpTicket: totp } });
      return;
    }
    api.refresh()
      .then((ok) => (ok ? login(getAccessToken()).then(() => navigate('/account', { replace: true }))
        : navigate('/login?error=oauth', { replace: true })))
      .catch(() => navigate('/login?error=oauth', { replace: true }));
  }, []);

  return <PageLoader label={t('auth.completing', 'Completing sign in…')} />;
}
