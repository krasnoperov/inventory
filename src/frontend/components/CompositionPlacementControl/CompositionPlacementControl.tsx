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
import { Button, UiSelect, type SelectOption } from '../../ui';
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
  const compositionOptions = useMemo<Array<SelectOption<string>>>(
    () => compositions.map((composition) => ({
      value: composition.id,
      label: composition.name,
    })),
    [compositions],
  );
  const roleOptions = useMemo<Array<SelectOption<CompositionPlacementRole>>>(
    () => COMPOSITION_PLACEMENT_ROLES.map((option) => ({
      value: option.role,
      label: option.label,
    })),
    [],
  );

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
      <div className={styles.controlRow}>
        <div className={styles.field}>
          <UiSelect
            className={styles.compositionSelect}
            value={selectedComposition.id}
            options={compositionOptions}
            label="Composition"
            onValueChange={(nextCompositionId) => {
              setCompositionId(nextCompositionId);
              setPlacedLabel(null);
            }}
          />
        </div>
        <div className={styles.field}>
          <UiSelect
            className={styles.roleSelect}
            value={role}
            options={roleOptions}
            label="Composition role"
            onValueChange={(nextRole) => {
              setRole(nextRole);
              setPlacedLabel(null);
            }}
          />
        </div>
        <Button className={styles.placeButton} onClick={handlePlace} variant="secondary" size="sm">
          Place
        </Button>
      </div>
      {placedLabel && <span className={styles.placed}>{placedLabel}</span>}
    </div>
  );
}
