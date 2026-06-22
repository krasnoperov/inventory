import { useMemo, useState } from 'react';
import type {
  Composition,
  CompositionItem,
  CompositionOverview,
  Variant,
} from '../../space/protocol';
import {
  COMPOSITION_PLACEMENT_ROLES,
  resolveCompositionPlacementShortcut,
  type CompositionPlacementRole,
  type CompositionShortcut,
} from '../../productionShortcuts';
import styles from './CompositionPlacementControl.module.css';

interface CompositionPlacementControlProps {
  compositions: Array<Composition | CompositionOverview>;
  compositionItems: CompositionItem[];
  /** The finished variant being placed. */
  variant: Variant;
  /** Apply the resolved placement (parent owns the composition mutations). */
  onPlace: (variant: Variant, shortcut: CompositionShortcut) => void;
  className?: string;
}

/**
 * Post-generation composition placement: drop a finished variant into a
 * composition as a chosen role. Composition and role are two separate selects —
 * not a single flat "role × composition" list — so the menu stays short no
 * matter how many compositions exist, and the choice is made over a real
 * result rather than predicted before generation.
 */
export function CompositionPlacementControl({
  compositions,
  compositionItems,
  variant,
  onPlace,
  className,
}: CompositionPlacementControlProps) {
  const [compositionId, setCompositionId] = useState(() => compositions[0]?.id ?? '');
  const [role, setRole] = useState<CompositionPlacementRole>('output');
  const [placedLabel, setPlacedLabel] = useState<string | null>(null);

  const selectedComposition = useMemo(
    () => compositions.find((composition) => composition.id === compositionId) ?? compositions[0] ?? null,
    [compositions, compositionId],
  );

  if (!selectedComposition) return null;

  const handlePlace = () => {
    const shortcut = resolveCompositionPlacementShortcut(selectedComposition.id, role, compositionItems);
    onPlace(variant, shortcut);
    const roleLabel = COMPOSITION_PLACEMENT_ROLES.find((option) => option.role === role)?.label ?? role;
    setPlacedLabel(`Added to ${selectedComposition.name} · ${roleLabel}`);
  };

  return (
    <div className={`${styles.control} ${className ?? ''}`.trim()}>
      <span className={styles.title}>Add to composition</span>
      <label className={styles.field}>
        <span>Composition</span>
        <select
          value={selectedComposition.id}
          aria-label="Composition"
          onChange={(event) => {
            setCompositionId(event.target.value);
            setPlacedLabel(null);
          }}
        >
          {compositions.map((composition) => (
            <option key={composition.id} value={composition.id}>{composition.name}</option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span>Role</span>
        <select
          value={role}
          aria-label="Composition role"
          onChange={(event) => {
            setRole(event.target.value as CompositionPlacementRole);
            setPlacedLabel(null);
          }}
        >
          {COMPOSITION_PLACEMENT_ROLES.map((option) => (
            <option key={option.role} value={option.role}>{option.label}</option>
          ))}
        </select>
      </label>
      <button type="button" className={styles.placeButton} onClick={handlePlace}>
        Place
      </button>
      {placedLabel && <span className={styles.placed}>{placedLabel}</span>}
    </div>
  );
}
