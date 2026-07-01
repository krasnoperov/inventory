import { useEffect, useState } from 'react';
import type { CollectionPlacementInput } from '../../shared/websocket-types';
import type { SpaceCollection } from '../space/protocol';
import { Checkbox, IconButton, TextInput, UiSelect, type SelectOption } from '../ui';
import styles from './CollectionPlacementPicker.module.css';

export const KNOWN_COLLECTION_ITEM_ROLES = [
  'character',
  'background',
  'scene',
  'style_ref',
  'thumbnail',
  'map',
  'deliverable',
  'custom',
] as const;

const ROLE_LABELS: Record<string, string> = {
  character: 'Character',
  background: 'Background',
  scene: 'Scene',
  style_ref: 'Style ref',
  thumbnail: 'Thumbnail',
  map: 'Map',
  deliverable: 'Deliverable',
  custom: 'Custom',
};

const ROLE_OPTIONS: Array<SelectOption<string>> = KNOWN_COLLECTION_ITEM_ROLES.map((role) => ({
  value: role,
  label: ROLE_LABELS[role],
}));

const SUBJECT_TYPE_OPTIONS: Array<SelectOption<'asset' | 'variant'>> = [
  { value: 'asset', label: 'Asset' },
  { value: 'variant', label: 'Exact variant' },
];

const ADD_COLLECTION_PLACEHOLDER = '__add_collection__';

function isKnownCollectionItemRole(role: string | undefined): role is typeof KNOWN_COLLECTION_ITEM_ROLES[number] {
  return Boolean(role && KNOWN_COLLECTION_ITEM_ROLES.includes(role as typeof KNOWN_COLLECTION_ITEM_ROLES[number]));
}

function getRoleLabel(role: string | undefined): string {
  if (!role || role === 'custom') return 'Custom role';
  return ROLE_LABELS[role] ?? role;
}

function getSubjectLabel(subjectType: 'asset' | 'variant'): string {
  return subjectType === 'variant' ? 'Exact variant' : 'Asset';
}

interface CollectionPlacementPickerProps {
  collections: SpaceCollection[];
  value: CollectionPlacementInput[];
  onChange: (value: CollectionPlacementInput[]) => void;
  label?: string;
  defaultSubjectType?: 'asset' | 'variant';
  allowSubjectChoice?: boolean;
  showPinToCreatedVariant?: boolean;
  showLabel?: boolean;
  addSelectLabel?: string;
  disabled?: boolean;
  className?: string;
}

export function getDefaultCollectionRole(collection: SpaceCollection): string {
  switch (collection.kind) {
    case 'cast':
      return 'character';
    case 'backgrounds':
      return 'background';
    case 'scenes':
      return 'scene';
    case 'style_refs':
      return 'style_ref';
    case 'thumbnails':
      return 'thumbnail';
    case 'maps':
      return 'map';
    case 'deliverables':
      return 'deliverable';
    default:
      return 'custom';
  }
}

export function getCollectionPlacementLabel(collection: SpaceCollection): string {
  return `Add to ${collection.name}`;
}

export function CollectionPlacementPicker({
  collections,
  value,
  onChange,
  label = 'Collections',
  defaultSubjectType = 'asset',
  allowSubjectChoice = false,
  showPinToCreatedVariant = false,
  showLabel = true,
  addSelectLabel = 'Add collection',
  disabled = false,
  className,
}: CollectionPlacementPickerProps) {
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null);

  useEffect(() => {
    if (editingCollectionId && !value.some((placement) => placement.collectionId === editingCollectionId)) {
      setEditingCollectionId(null);
    }
  }, [editingCollectionId, value]);

  if (collections.length === 0) return null;

  const selectedByCollection = new Map(value.map((placement) => [placement.collectionId, placement]));
  const availableCollections = collections.filter((collection) => !selectedByCollection.has(collection.id));
  const addCollectionOptions: Array<SelectOption<string>> = [
    {
      value: ADD_COLLECTION_PLACEHOLDER,
      label: availableCollections.length > 0 ? 'Add collection' : 'All collections added',
      disabled: true,
    },
    ...availableCollections.map((collection) => ({
      value: collection.id,
      label: collection.name,
      textValue: getCollectionPlacementLabel(collection),
    })),
  ];

  const setPlacement = (collectionId: string, changes: Partial<CollectionPlacementInput>) => {
    onChange(value.map((placement) => (
      placement.collectionId === collectionId ? { ...placement, ...changes } : placement
    )));
  };

  const addCollection = (collectionId: string) => {
    if (collectionId === ADD_COLLECTION_PLACEHOLDER) return;
    const collection = collections.find((candidate) => candidate.id === collectionId);
    if (!collection || selectedByCollection.has(collection.id)) return;
    setEditingCollectionId(collection.id);
    onChange([
      ...value,
      {
        collectionId: collection.id,
        role: getDefaultCollectionRole(collection),
        subjectType: defaultSubjectType,
        pinToCreatedVariant: showPinToCreatedVariant && defaultSubjectType === 'asset',
      },
    ]);
  };

  const removeCollection = (collectionId: string) => {
    onChange(value.filter((placement) => placement.collectionId !== collectionId));
  };

  return (
    <div className={`${styles.picker} ${className ?? ''}`}>
      <div className={styles.addRow}>
        {showLabel && <p className={styles.label}>{label}</p>}
        <UiSelect
          className={styles.addSelect}
          value={ADD_COLLECTION_PLACEHOLDER}
          options={addCollectionOptions}
          disabled={disabled || availableCollections.length === 0}
          label={addSelectLabel}
          onValueChange={addCollection}
        />
      </div>
      {value.length > 0 && (
        <div className={styles.placementRows}>
          {value.map((placement) => {
            const collection = collections.find((candidate) => candidate.id === placement.collectionId);
            if (!collection) return null;
            const selectedRole = isKnownCollectionItemRole(placement.role) ? placement.role : 'custom';
            const subjectType = placement.subjectType ?? defaultSubjectType;
            const isEditing = editingCollectionId === collection.id;
            const roleLabel = getRoleLabel(placement.role);
            const subjectLabel = getSubjectLabel(subjectType);

            return (
              <div
                key={placement.collectionId}
                className={`${styles.placementRow} ${isEditing ? styles.placementRowEditing : ''}`}
              >
                <div className={styles.placementSummary}>
                  <span className={styles.collectionName}>{collection.name}</span>
                  <span className={styles.summaryMeta} title={roleLabel}>{roleLabel}</span>
                  {allowSubjectChoice && <span className={styles.summaryMeta} title={subjectLabel}>{subjectLabel}</span>}
                  {showPinToCreatedVariant && subjectType === 'asset' && placement.pinToCreatedVariant !== false && (
                    <span className={styles.summaryMeta}>Pinned</span>
                  )}
                </div>
                <div className={styles.placementActions}>
                  <IconButton
                    className={styles.editButton}
                    variant={isEditing ? 'secondary' : 'ghost'}
                    size="sm"
                    aria-label={`${isEditing ? 'Done editing' : 'Edit'} ${collection.name} placement draft`}
                    title={`${isEditing ? 'Done editing' : 'Edit'} ${collection.name} placement draft`}
                    disabled={disabled}
                    onClick={() => setEditingCollectionId(isEditing ? null : collection.id)}
                  >
                    {isEditing ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" width="14" height="14" aria-hidden="true">
                        <path d="m5 12 4 4L19 6" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="14" height="14" aria-hidden="true">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                    )}
                  </IconButton>
                  <IconButton
                    className={styles.removeButton}
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${collection.name} placement draft`}
                    title={`Remove ${collection.name} placement draft`}
                    disabled={disabled}
                    onClick={() => removeCollection(collection.id)}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="14" height="14" aria-hidden="true">
                      <path d="M4 7h16" />
                      <path d="M10 11v6M14 11v6" />
                      <path d="M6 7l1 13h10l1-13" />
                      <path d="M9 7V4h6v3" />
                    </svg>
                  </IconButton>
                </div>
                {isEditing && (
                  <div className={styles.placementControls}>
                    <UiSelect
                      className={styles.select}
                      value={selectedRole}
                      options={ROLE_OPTIONS}
                      disabled={disabled}
                      label={`Role for ${collection.name}`}
                      onValueChange={(role) => {
                        setPlacement(collection.id, { role: role === 'custom' ? 'custom' : role });
                      }}
                    />
                    {selectedRole === 'custom' && (
                      <TextInput
                        className={styles.input}
                        value={placement.role && placement.role !== 'custom' ? placement.role : ''}
                        placeholder="Custom role"
                        disabled={disabled}
                        aria-label={`Custom role for ${collection.name}`}
                        onChange={(event) => setPlacement(collection.id, { role: event.target.value || 'custom' })}
                        fullWidth
                      />
                    )}
                    {allowSubjectChoice && (
                      <UiSelect
                        className={`${styles.select} ${styles.subjectSelect}`}
                        value={subjectType}
                        options={SUBJECT_TYPE_OPTIONS}
                        disabled={disabled}
                        label={`Collection subject for ${collection.name}`}
                        onValueChange={(nextSubjectType) => {
                          setPlacement(collection.id, {
                            subjectType: nextSubjectType,
                            pinToCreatedVariant: showPinToCreatedVariant && nextSubjectType === 'asset',
                          });
                        }}
                      />
                    )}
                    {showPinToCreatedVariant && subjectType === 'asset' && (
                      <label className={styles.pinToggle}>
                        <Checkbox
                          checked={placement.pinToCreatedVariant !== false}
                          disabled={disabled}
                          onChange={(event) => setPlacement(collection.id, { pinToCreatedVariant: event.target.checked })}
                        />
                        <span>Pin variant</span>
                      </label>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
