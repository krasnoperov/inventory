import { useState, useEffect, useCallback } from 'react';
import styles from './ChatSidebar.module.css';

// =============================================================================
// Types
// =============================================================================

export interface UserPattern {
  id: string;
  assetType: string;
  promptText: string;
  successCount: number;
  totalUses: number;
  styleTags: string[];
  lastUsedAt: string;
  createdAt: string;
  spaceId: string | null;
}

export interface UserPreferences {
  defaultArtStyle: string | null;
  defaultAspectRatio: string | null;
  autoExecuteSafe: boolean;
  autoApproveLowCost: boolean;
  injectPatterns: boolean;
  maxPatternsContext: number;
}

export interface PreferencesPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

// =============================================================================
// Constants
// =============================================================================

const ART_STYLES = [
  { value: '', label: 'No default' },
  { value: 'pixel_art', label: 'Pixel Art' },
  { value: 'fantasy_realism', label: 'Fantasy Realism' },
  { value: 'anime', label: 'Anime' },
  { value: 'cartoon', label: 'Cartoon' },
  { value: 'painterly', label: 'Painterly' },
  { value: 'photorealistic', label: 'Photorealistic' },
];

const ASPECT_RATIOS = [
  { value: '', label: 'No default' },
  { value: '1:1', label: '1:1 (Square)' },
  { value: '16:9', label: '16:9 (Widescreen)' },
  { value: '9:16', label: '9:16 (Portrait)' },
  { value: '4:3', label: '4:3 (Standard)' },
  { value: '3:4', label: '3:4 (Portrait Standard)' },
];

// =============================================================================
// Component
// =============================================================================

export function PreferencesPanel({ isOpen, onClose }: PreferencesPanelProps) {
  const [patterns, setPatterns] = useState<UserPattern[]>([]);
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch data when panel opens
  useEffect(() => {
    if (isOpen) {
      fetchData();
    }
  }, [isOpen]);

  const fetchData = async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch patterns and preferences in parallel
      const [patternsRes, prefsRes] = await Promise.all([
        fetch('/api/users/me/patterns', { credentials: 'include' }),
        fetch('/api/users/me/preferences', { credentials: 'include' }),
      ]);

      if (!patternsRes.ok || !prefsRes.ok) {
        throw new Error('Failed to load preferences');
      }

      const patternsData = await patternsRes.json() as { patterns?: UserPattern[] };
      const prefsData = await prefsRes.json() as { preferences?: UserPreferences };

      setPatterns(patternsData.patterns || []);
      setPreferences(prefsData.preferences || null);
    } catch (err) {
      console.error('Error fetching preferences:', err);
      setError('Failed to load preferences');
    } finally {
      setLoading(false);
    }
  };

  const handleDeletePattern = async (patternId: string) => {
    try {
      const res = await fetch(`/api/users/me/patterns/${patternId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!res.ok) {
        throw new Error('Failed to delete pattern');
      }

      setPatterns(prev => prev.filter(p => p.id !== patternId));
    } catch (err) {
      console.error('Error deleting pattern:', err);
      setError('Failed to delete pattern');
    }
  };

  const handlePreferenceChange = useCallback(async (updates: Partial<UserPreferences>) => {
    if (!preferences) return;

    setSaving(true);
    setError(null);

    try {
      const res = await fetch('/api/users/me/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates),
      });

      if (!res.ok) {
        throw new Error('Failed to save preferences');
      }

      setPreferences(prev => prev ? { ...prev, ...updates } : null);
    } catch (err) {
      console.error('Error saving preferences:', err);
      setError('Failed to save preferences');
    } finally {
      setSaving(false);
    }
  }, [preferences]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    return `${Math.floor(diffDays / 30)} months ago`;
  };

  if (!isOpen) return null;

  return (
    <div className={styles.preferencesOverlay} onClick={onClose}>
      <div className={styles.preferencesPanel} onClick={e => e.stopPropagation()}>
        <div className={styles.preferencesPanelHeader}>
          <span className={styles.preferencesIcon}>&#9881;</span>
          <span className={styles.preferencesTitle}>Assistant Preferences</span>
          <button className={styles.preferencesClose} onClick={onClose}>
            &times;
          </button>
        </div>

        {error && (
          <div className={styles.preferencesError}>{error}</div>
        )}

        {loading ? (
          <div className={styles.preferencesLoading}>Loading...</div>
        ) : (
          <div className={styles.preferencesContent}>
            {/* Learned Patterns Section */}
            <section className={styles.preferencesSection}>
              <h3 className={styles.preferencesSectionTitle}>Learned Patterns</h3>
              <p className={styles.preferencesSectionDesc}>
                Prompts that worked well for you. These are suggested to the assistant.
              </p>

              {patterns.length === 0 ? (
                <div className={styles.preferencesEmpty}>
                  No patterns learned yet. Generate some assets and give feedback!
                </div>
              ) : (
                <div className={styles.patternsList}>
                  {patterns.map(pattern => (
                    <div key={pattern.id} className={styles.patternItem}>
                      <div className={styles.patternInfo}>
                        <span className={styles.patternType}>[{pattern.assetType}]</span>
                        <span className={styles.patternText}>
                          "{pattern.promptText.slice(0, 60)}
                          {pattern.promptText.length > 60 ? '...' : ''}"
                        </span>
                        <span className={styles.patternMeta}>
                          Used {pattern.successCount}x · Last: {formatDate(pattern.lastUsedAt)}
                        </span>
                      </div>
                      <button
                        className={styles.patternDelete}
                        onClick={() => handleDeletePattern(pattern.id)}
                        title="Forget this pattern"
                      >
                        Forget
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Style Preferences Section */}
            {preferences && (
              <section className={styles.preferencesSection}>
                <h3 className={styles.preferencesSectionTitle}>Style Preferences</h3>

                <div className={styles.preferencesField}>
                  <label className={styles.preferencesLabel}>Default Art Style</label>
                  <select
                    className={styles.preferencesSelect}
                    value={preferences.defaultArtStyle || ''}
                    onChange={(e) => handlePreferenceChange({
                      defaultArtStyle: e.target.value || null
                    })}
                    disabled={saving}
                  >
                    {ART_STYLES.map(style => (
                      <option key={style.value} value={style.value}>
                        {style.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.preferencesField}>
                  <label className={styles.preferencesLabel}>Default Aspect Ratio</label>
                  <select
                    className={styles.preferencesSelect}
                    value={preferences.defaultAspectRatio || ''}
                    onChange={(e) => handlePreferenceChange({
                      defaultAspectRatio: e.target.value || null
                    })}
                    disabled={saving}
                  >
                    {ASPECT_RATIOS.map(ratio => (
                      <option key={ratio.value} value={ratio.value}>
                        {ratio.label}
                      </option>
                    ))}
                  </select>
                </div>
              </section>
            )}

            {/* Trust Settings Section */}
            {preferences && (
              <section className={styles.preferencesSection}>
                <h3 className={styles.preferencesSectionTitle}>Trust Settings</h3>

                <div className={styles.preferencesCheckbox}>
                  <label>
                    <input
                      type="checkbox"
                      checked={preferences.autoExecuteSafe}
                      onChange={(e) => handlePreferenceChange({
                        autoExecuteSafe: e.target.checked
                      })}
                      disabled={saving}
                    />
                    <span>Auto-execute safe operations</span>
                  </label>
                  <span className={styles.preferencesHint}>
                    Automatically run search, describe, and tray operations
                  </span>
                </div>

                <div className={styles.preferencesCheckbox}>
                  <label>
                    <input
                      type="checkbox"
                      checked={preferences.autoApproveLowCost}
                      onChange={(e) => handlePreferenceChange({
                        autoApproveLowCost: e.target.checked
                      })}
                      disabled={saving}
                    />
                    <span>Auto-approve low-cost generations</span>
                  </label>
                  <span className={styles.preferencesHint}>
                    Skip approval for quick refinements (coming soon)
                  </span>
                </div>

                <div className={styles.preferencesCheckbox}>
                  <label>
                    <input
                      type="checkbox"
                      checked={preferences.injectPatterns}
                      onChange={(e) => handlePreferenceChange({
                        injectPatterns: e.target.checked
                      })}
                      disabled={saving}
                    />
                    <span>Use learned patterns in suggestions</span>
                  </label>
                  <span className={styles.preferencesHint}>
                    Include your successful prompts in assistant context
                  </span>
                </div>

                {preferences.injectPatterns && (
                  <div className={styles.preferencesField}>
                    <label className={styles.preferencesLabel}>
                      Max patterns in context: {preferences.maxPatternsContext}
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="10"
                      value={preferences.maxPatternsContext}
                      onChange={(e) => handlePreferenceChange({
                        maxPatternsContext: parseInt(e.target.value, 10)
                      })}
                      disabled={saving}
                      className={styles.preferencesRange}
                    />
                  </div>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
