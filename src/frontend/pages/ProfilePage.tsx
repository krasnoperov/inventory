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
import type { ProviderKeyProvider, ProviderKeySummary, UserProfile } from '../../api/types';
import { providerKeysQueryOptions, userProfileQueryOptions } from '../queries';
import styles from './ProfilePage.module.css';

const providerHelp: Record<ProviderKeyProvider, string> = {
  google_ai: 'Gemini image and Veo video generation',
  anthropic: 'Claude chat and image analysis',
  elevenlabs: 'Speech, dialogue, sound effects, and ElevenLabs music',
  lyria: 'Google Lyria music generation',
};

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
  const providerKeysQuery = useQuery({
    ...providerKeysQueryOptions(),
    enabled: Boolean(user),
  });
  const providerKeys = providerKeysQuery.data ?? [];
  const isLoading = profileQuery.isPending;
  const [isSaving, setIsSaving] = useState(false);
  const [savingProvider, setSavingProvider] = useState<ProviderKeyProvider | null>(null);
  const [deletingProvider, setDeletingProvider] = useState<ProviderKeyProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [providerError, setProviderError] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [name, setName] = useState(profile?.name ?? '');
  const [providerDrafts, setProviderDrafts] = useState<Record<string, string>>({});

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

  const handleSaveProvider = async (provider: ProviderKeyProvider) => {
    const apiKey = (providerDrafts[provider] ?? '').trim();
    if (!apiKey) {
      setProviderError('API key is required');
      return;
    }

    setSavingProvider(provider);
    setProviderError(null);
    setSuccessMessage(null);

    try {
      await apiFetch('PUT /api/user/provider-keys/:provider', {
        params: { provider },
        json: { apiKey },
      });
      setProviderDrafts((prev) => ({ ...prev, [provider]: '' }));
      await queryClient.invalidateQueries({ queryKey: providerKeysQueryOptions().queryKey });
      setSuccessMessage('Provider key saved');
    } catch (err) {
      console.error('Provider key save error:', err);
      setProviderError(err instanceof Error ? err.message : 'Failed to save provider key');
    } finally {
      setSavingProvider(null);
    }
  };

  const handleDeleteProvider = async (provider: ProviderKeyProvider) => {
    setDeletingProvider(provider);
    setProviderError(null);
    setSuccessMessage(null);

    try {
      await apiFetch('DELETE /api/user/provider-keys/:provider', {
        params: { provider },
      });
      await queryClient.invalidateQueries({ queryKey: providerKeysQueryOptions().queryKey });
      setSuccessMessage('Provider key removed');
    } catch (err) {
      console.error('Provider key delete error:', err);
      setProviderError(err instanceof Error ? err.message : 'Failed to remove provider key');
    } finally {
      setDeletingProvider(null);
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

            <section className={styles.providerSection} aria-labelledby="provider-keys-title">
              <div className={styles.sectionHeader}>
                <h2 id="provider-keys-title" className={styles.sectionTitle}>Provider keys</h2>
              </div>

              <ErrorMessage
                message={providerError || (providerKeysQuery.error instanceof Error ? providerKeysQuery.error.message : null)}
              />

              <div className={styles.providerList}>
                {providerKeys.map((provider: ProviderKeySummary) => {
                  const draft = providerDrafts[provider.provider] ?? '';
                  const isProviderSaving = savingProvider === provider.provider;
                  const isProviderDeleting = deletingProvider === provider.provider;
                  const status = provider.configured
                    ? provider.keyHint
                    : provider.platformConfigured ? 'Platform key' : 'Not configured';

                  return (
                    <div key={provider.provider} className={styles.providerRow}>
                      <div className={styles.providerInfo}>
                        <div className={styles.providerTitleRow}>
                          <h3 className={styles.providerName}>{provider.label}</h3>
                          <span
                            className={styles.providerStatus}
                            data-state={provider.configured ? 'configured' : provider.platformConfigured ? 'platform' : 'missing'}
                          >
                            {status}
                          </span>
                        </div>
                        <p className={styles.providerDescription}>{providerHelp[provider.provider]}</p>
                      </div>

                      <div className={styles.providerControls}>
                        <input
                          type="password"
                          value={draft}
                          onChange={(event) => setProviderDrafts((prev) => ({
                            ...prev,
                            [provider.provider]: event.target.value,
                          }))}
                          className={formStyles.input}
                          placeholder={provider.configured ? 'Replace API key' : 'API key'}
                          autoComplete="off"
                          disabled={isProviderSaving || isProviderDeleting}
                          aria-label={`${provider.label} API key`}
                        />
                        <div className={styles.providerActions}>
                          <button
                            type="button"
                            className={formStyles.submitButton}
                            disabled={isProviderSaving || isProviderDeleting || !draft.trim()}
                            onClick={() => void handleSaveProvider(provider.provider)}
                          >
                            {isProviderSaving ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            type="button"
                            className={styles.secondaryButton}
                            disabled={isProviderSaving || isProviderDeleting || !provider.configured}
                            onClick={() => void handleDeleteProvider(provider.provider)}
                          >
                            {isProviderDeleting ? 'Removing...' : 'Remove'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </FormContainer>
        )}
      </main>
    </div>
  );
}
