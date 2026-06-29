import { useGoogleLogin } from '@react-oauth/google';
import { getRouteApi } from '@tanstack/react-router';
import { useNavigate } from '../hooks/useNavigate';
import { useAuth } from '../contexts/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { apiFetch } from '../../api/client';
import { FormContainer, FormTitle } from '../components/forms';
import { Button } from '../ui';
import styles from './LoginPage.module.css';

const loginRoute = getRouteApi('/login');

interface GoogleLoginButtonProps {
  onClick: () => void;
}

export function GoogleLoginButton({ onClick }: GoogleLoginButtonProps) {
  return (
    <Button onClick={onClick} className={styles.googleButton} variant="secondary">
      <svg className={styles.googleIcon} viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
      </svg>
      Sign in with Google
    </Button>
  );
}

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const { redirect } = loginRoute.useSearch();
  useDocumentTitle('Sign in');

  const googleLogin = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      console.log('Google login success, token received:', tokenResponse);
      try {
        const data = await apiFetch('POST /api/auth/google', {
          json: {
            access_token: tokenResponse.access_token,
          },
        });

        login(data.user);
        navigate(redirect ?? '/');
      } catch (error) {
        console.error('Error during authentication:', error);
      }
    },
    onError: () => {
      console.error('Google login failed');
    },
  });

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <FormContainer maxWidth={440}>
          <FormTitle>Welcome!</FormTitle>
          <p className={styles.subtitle}>Sign in to access your account</p>

          <GoogleLoginButton onClick={() => googleLogin()} />
        </FormContainer>

        <section className={styles.agentGuide} aria-labelledby="agent-guide-title">
          <div>
            <p className={styles.agentEyebrow}>For coding agents</p>
            <h2 id="agent-guide-title" className={styles.agentTitle}>Hit login from a Space link?</h2>
            <p className={styles.agentIntro}>
              Do not stop at "could not inspect." Use the Make Effects CLI as the authenticated
              control surface for Space content.
            </p>
          </div>

          <ol className={styles.agentSteps}>
            <li>
              Try <code>makefx spaces --id SPACE_ID --json</code>; if it reports
              missing or expired auth, run <code>makefx login</code> and retry.
            </li>
            <li>
              Prefer CLI reads for Space metadata, assets, variants, and live events before
              opening a private web page.
            </li>
            <li>
              When browser or curl inspection is needed from this repo, mint a short web session:
              <code>pnpm auth:session-state --format cookie</code>
            </li>
          </ol>

          <p className={styles.agentNote}>
            Repeated redirects are also a signal to install or activate{' '}
            <a
              className={styles.agentLink}
              href="https://github.com/krasnoperov/makefx-skills/tree/main/skills/makefx-space-access"
              rel="noreferrer"
              target="_blank"
            >
              makefx-space-access
            </a>{' '}
            before retrying the link.
          </p>
        </section>
      </div>
    </div>
  );
}
