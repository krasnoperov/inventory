import { useMemo, useState, useCallback } from 'react';
import type {
  SpaceCollection,
  StylePresetCreateParams,
  StylePresetRaw,
  StylePresetUpdateParams,
} from '../../hooks/useSpaceWebSocket';
import { Button, IconButton, UiSelect, type SelectOption } from '../../ui';
import styles from './StylePanel.module.css';

export interface StyleReferenceOption {
  variantId: string;
  label: string;
  collectionName: string;
}

export interface StylePanelProps {
  spaceId: string;
  onClose: () => void;
  stylePresets?: StylePresetRaw[];
  styleReferenceCollections?: SpaceCollection[];
  customStyleOptions?: StyleReferenceOption[];
  customStyleVariantIds?: string[];
  onToggleCustomStyleVariant?: (variantId: string) => void;
  createStylePreset?: (params: StylePresetCreateParams) => void;
  updateStylePreset?: (presetId: string, changes: StylePresetUpdateParams) => void;
  deleteStylePreset?: (presetId: string) => void;
}

function isEnabledPreset(preset: StylePresetRaw): boolean {
  return preset.enabled === true || preset.enabled === 1;
}

function isDefaultPreset(preset: StylePresetRaw): boolean {
  return preset.is_default === true || preset.is_default === 1;
}

function formatRefCount(count: number): string {
  return `${count} ref${count === 1 ? '' : 's'}`;
}

export function StylePanel({
  onClose,
  stylePresets = [],
  styleReferenceCollections = [],
  customStyleOptions = [],
  customStyleVariantIds = [],
  onToggleCustomStyleVariant,
  createStylePreset,
  updateStylePreset,
  deleteStylePreset,
}: StylePanelProps) {
  const [name, setName] = useState('');
  const [stylePrompt, setStylePrompt] = useState('');
  const [description, setDescription] = useState('');
  const [collectionId, setCollectionId] = useState(styleReferenceCollections[0]?.id ?? '');
  const [makeDefault, setMakeDefault] = useState(false);

  const sortedPresets = useMemo(
    () => [...stylePresets].sort((a, b) => Number(isDefaultPreset(b)) - Number(isDefaultPreset(a)) || a.name.localeCompare(b.name)),
    [stylePresets],
  );
  const selectedCollectionId = collectionId || styleReferenceCollections[0]?.id || '';
  const collectionOptions = useMemo<Array<SelectOption<string>>>(
    () => styleReferenceCollections.length === 0
      ? [{ value: '', label: 'No style collections' }]
      : styleReferenceCollections.map((collection) => ({
        value: collection.id,
        label: collection.name,
      })),
    [styleReferenceCollections],
  );

  const handleCreatePreset = useCallback(() => {
    const trimmedName = name.trim();
    if (!trimmedName || !selectedCollectionId || !createStylePreset) return;
    createStylePreset({
      name: trimmedName,
      description: description.trim() || null,
      stylePrompt: stylePrompt.trim(),
      collectionId: selectedCollectionId,
      enabled: true,
      isDefault: makeDefault,
    });
    setName('');
    setStylePrompt('');
    setDescription('');
    setMakeDefault(false);
  }, [createStylePreset, description, makeDefault, name, selectedCollectionId, stylePrompt]);

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.stylePanel} onClick={(event) => event.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>Style Library</span>
          <IconButton onClick={onClose} title="Close" aria-label="Close" variant="ghost" size="sm">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </IconButton>
        </div>

        <div className={styles.body}>
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h3>Create preset</h3>
              <span>{styleReferenceCollections.length} collections</span>
            </div>
            <div className={styles.formGrid}>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Preset name"
                aria-label="Preset name"
              />
              <UiSelect
                value={selectedCollectionId}
                options={collectionOptions}
                onValueChange={setCollectionId}
                label="Style collection"
                disabled={styleReferenceCollections.length === 0}
                fullWidth
              />
              <textarea
                value={stylePrompt}
                onChange={(event) => setStylePrompt(event.target.value)}
                placeholder="Style prompt"
                aria-label="Style prompt"
                rows={3}
              />
              <input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Description"
                aria-label="Style description"
              />
              <label className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={makeDefault}
                  onChange={(event) => setMakeDefault(event.target.checked)}
                />
                <span>Set as space default</span>
              </label>
              <Button
                onClick={handleCreatePreset}
                disabled={!name.trim() || !selectedCollectionId || !createStylePreset}
                variant="primary"
                size="sm"
              >
                Create preset
              </Button>
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h3>Presets</h3>
              <span>{sortedPresets.length}</span>
            </div>
            <div className={styles.presetList}>
              {sortedPresets.map((preset) => {
                const enabled = isEnabledPreset(preset);
                const isDefault = isDefaultPreset(preset);
                return (
                  <article key={preset.id} className={styles.presetCard}>
                    <div className={styles.presetMain}>
                      <div>
                        <strong>{preset.name}</strong>
                        <span>{preset.collection_name ?? 'No collection'} · {formatRefCount(preset.reference_count)}</span>
                      </div>
                      {isDefault && <span className={styles.defaultBadge}>Default</span>}
                    </div>
                    <textarea
                      className={styles.compactTextarea}
                      defaultValue={preset.style_prompt}
                      aria-label={`Style prompt for ${preset.name}`}
                      rows={2}
                      onBlur={(event) => {
                        if (event.target.value !== preset.style_prompt) {
                          updateStylePreset?.(preset.id, { stylePrompt: event.target.value });
                        }
                      }}
                      disabled={!updateStylePreset}
                    />
                    <input
                      className={styles.compactInput}
                      defaultValue={preset.description ?? ''}
                      aria-label={`Description for ${preset.name}`}
                      placeholder="Description"
                      onBlur={(event) => {
                        const next = event.target.value.trim() || null;
                        if (next !== (preset.description ?? null)) {
                          updateStylePreset?.(preset.id, { description: next });
                        }
                      }}
                      disabled={!updateStylePreset}
                    />
                    <div className={styles.presetActions}>
                      <label className={styles.checkRow}>
                        <input
                          type="checkbox"
                          checked={enabled}
                          disabled={isDefault || !updateStylePreset}
                          onChange={(event) => updateStylePreset?.(preset.id, { enabled: event.target.checked })}
                        />
                        <span>Enabled</span>
                      </label>
                      <Button
                        onClick={() => updateStylePreset?.(preset.id, { isDefault: true, enabled: true })}
                        disabled={isDefault || !enabled || !updateStylePreset}
                        variant="secondary"
                        size="sm"
                      >
                        Set default
                      </Button>
                      <Button
                        onClick={() => deleteStylePreset?.(preset.id)}
                        disabled={!deleteStylePreset}
                        variant="danger"
                        size="sm"
                      >
                        Delete
                      </Button>
                    </div>
                  </article>
                );
              })}
              {sortedPresets.length === 0 && (
                <div className={styles.emptyState}>No style presets</div>
              )}
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h3>Custom request refs</h3>
              <span>{customStyleVariantIds.length} selected</span>
            </div>
            <div className={styles.refList}>
              {customStyleOptions.map((option) => (
                <label key={option.variantId} className={styles.refRow}>
                  <input
                    type="checkbox"
                    checked={customStyleVariantIds.includes(option.variantId)}
                    onChange={() => onToggleCustomStyleVariant?.(option.variantId)}
                    disabled={!onToggleCustomStyleVariant}
                  />
                  <span>{option.label}</span>
                  <small>{option.collectionName}</small>
                </label>
              ))}
              {customStyleOptions.length === 0 && (
                <div className={styles.emptyState}>Add assets to a Style References collection to use custom refs.</div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default StylePanel;
