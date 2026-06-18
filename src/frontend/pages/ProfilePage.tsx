import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '../components/Link';
import { useNavigate } from '../hooks/useNavigate';
import { useAuth } from '../contexts/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { AppHeader } from '../components/AppHeader';
import { HeaderNav } from '../components/HeaderNav';
import { FormContainer, FormTitle, ErrorMessage, formStyles } from '../components/forms';
import { BillingSection } from '../components/BillingSection';
import { apiFetch } from '../../api/client';
import type { UserProfile } from '../../api/types';
import { userProfileQueryOptions } from '../queries';
import styles from './ProfilePage.module.css';

export default function ProfilePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  useDocumentTitle('Profile');

  const profileQuery = useQuery({
    ...userProfileQueryOptions(),
    enabled: Boolean(user),
  });
  const profile = profileQuery.data ?? null;
  const isLoading = profileQuery.isPending;
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [name, setName] = useState(profile?.name ?? '');

  useEffect(() => {
    if (!user) {
      navigate('/login');
    }
  }, [user, navigate]);

  useEffect(() => {
    if (profile) {
      setName(profile.name);
    }
  }, [profile]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const data = await apiFetch('PATCH /api/user/profile', {
        json: {
          name: name.trim(),
        },
      });
      queryClient.setQueryData<UserProfile>(userProfileQueryOptions().queryKey, data.user);
      setSuccessMessage('Profile updated successfully!');

      // Clear success message after 3 seconds
      setTimeout(() => {
        setSuccessMessage(null);
      }, 3000);
    } catch (err) {
      console.error('Profile update error:', err);
      setError(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setIsSaving(false);
    }
  };

  const headerRightSlot = user ? (
    <HeaderNav userName={user.name} userEmail={user.email} />
  ) : (
    <Link to="/login" className={styles.authButton}>Sign In</Link>
  );

  return (
    <div className={styles.page}>
      <AppHeader
        leftSlot={(
          <Link to="/" className={styles.brand}>
            Make Effects
          </Link>
        )}
        rightSlot={headerRightSlot}
      />

      <main className={styles.main}>
        {isLoading ? (
          <FormContainer maxWidth={640}>
            <div className={styles.loading}>Loading your profile...</div>
          </FormContainer>
        ) : (
          <FormContainer maxWidth={640}>
            <FormTitle>Your Profile</FormTitle>

            <ErrorMessage
              message={error || (profileQuery.error instanceof Error ? profileQuery.error.message : null)}
            />

            <form onSubmit={handleSubmit}>
              <div className={formStyles.formGroup}>
                <label htmlFor="name" className={formStyles.label}>
                  Name *
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={formStyles.input}
                  placeholder="Enter your name"
                  disabled={isSaving}
                />
              </div>

              <div className={formStyles.formGroup}>
                <label htmlFor="email" className={formStyles.label}>
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={profile?.email || ''}
                  className={`${formStyles.input} ${formStyles.readonly}`}
                  disabled
                  readOnly
                />
              </div>

              <button
                type="submit"
                className={formStyles.submitButton}
                disabled={isSaving}
              >
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </form>

            <BillingSection />
          </FormContainer>
        )}
      </main>
    </div>
  );
}
