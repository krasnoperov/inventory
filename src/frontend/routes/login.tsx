import { createFileRoute } from '@tanstack/react-router';
import LoginPage from '../pages/LoginPage';

export const Route = createFileRoute('/login')({
  validateSearch: (search): { redirect?: string } => {
    const redirect = sanitizeRedirect(search.redirect);
    return redirect ? { redirect } : {};
  },
  component: LoginPage,
});

function sanitizeRedirect(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return undefined;
  }
  return value;
}
