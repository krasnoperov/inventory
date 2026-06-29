import type { CollectionPlacementInput } from '../../shared/websocket-types';
import type { SpaceCollection } from '../space/protocol';
import { UiSelect, type SelectOption } from '../ui';
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

function isKnownCollectionItemRole(role: string | undefined): role is typeof KNOWN_COLLECTION_ITEM_ROLES[number] {
  return Boolean(role && KNOWN_COLLECTION_ITEM_ROLES.includes(role as typeof KNOWN_COLLECTION_ITEM_ROLES[number]));
}

interface CollectionPlacementPickerProps {
  collections: SpaceCollection[];
  value: CollectionPlacementInput[];
  onChange: (value: CollectionPlacementInput[]) => void;
  label?: string;
  defaultSubjectType?: 'asset' | 'variant';
  allowSubjectChoice?: boolean;
  showPinToCreatedVariant?: boolean;
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
  disabled = false,
  className,
}: CollectionPlacementPickerProps) {
  if (collections.length === 0) return null;

  const selectedByCollection = new Map(value.map((placement) => [placement.collectionId, placement]));

  const setPlacement = (collectionId: string, changes: Partial<CollectionPlacementInput>) => {
    onChange(value.map((placement) => (
      placement.collectionId === collectionId ? { ...placement, ...changes } : placement
    )));
  };

  const toggleCollection = (collection: SpaceCollection, checked: boolean) => {
    if (!checked) {
      onChange(value.filter((placement) => placement.collectionId !== collection.id));
      return;
    }
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

  return (
    <div className={`${styles.picker} ${className ?? ''}`}>
      <p className={styles.label}>{label}</p>
      <div className={styles.collectionList}>
        {collections.map((collection) => (
          <label key={collection.id} className={styles.collectionToggle}>
            <input
              type="checkbox"
              checked={selectedByCollection.has(collection.id)}
              disabled={disabled}
              onChange={(event) => toggleCollection(collection, event.target.checked)}
            />
            <span>{getCollectionPlacementLabel(collection)}</span>
          </label>
        ))}
      </div>
      {value.length > 0 && (
        <div className={styles.placementRows}>
          {value.map((placement) => {
            const collection = collections.find((candidate) => candidate.id === placement.collectionId);
            if (!collection) return null;
            const selectedRole = isKnownCollectionItemRole(placement.role) ? placement.role : 'custom';
            const subjectType = placement.subjectType ?? defaultSubjectType;

            return (
              <div key={placement.collectionId} className={styles.placementRow}>
                <span className={styles.collectionName}>{collection.name}</span>
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
                  <input
                    className={styles.input}
                    value={placement.role && placement.role !== 'custom' ? placement.role : ''}
                    placeholder="Custom role"
                    disabled={disabled}
                    aria-label={`Custom role for ${collection.name}`}
                    onChange={(event) => setPlacement(collection.id, { role: event.target.value || 'custom' })}
                  />
                )}
                {allowSubjectChoice && (
                  <UiSelect
                    className={styles.select}
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
                    <input
                      type="checkbox"
                      checked={placement.pinToCreatedVariant !== false}
                      disabled={disabled}
                      onChange={(event) => setPlacement(collection.id, { pinToCreatedVariant: event.target.checked })}
                    />
                    <span>Pin variant</span>
                  </label>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
