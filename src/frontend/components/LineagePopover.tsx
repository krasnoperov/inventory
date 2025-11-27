import { useEffect, useRef, useCallback, useMemo } from 'react';
import type { Variant, Asset, Lineage } from '../hooks/useSpaceWebSocket';
import styles from './LineagePopover.module.css';

export interface LineagePopoverProps {
  variant: Variant;
  asset: Asset;
  allVariants: Variant[];
  allAssets: Asset[];
  lineage: Lineage[];
  position: { x: number; y: number };
  onClose: () => void;
  onVariantClick?: (variant: Variant, asset: Asset) => void;
}

interface LineageNode {
  variant: Variant;
  asset: Asset;
  relation: 'parent' | 'self' | 'child';
  lineageType?: 'refined' | 'spawned';
  severed?: boolean;
}

export function LineagePopover({
  variant,
  asset,
  allVariants,
  allAssets,
  lineage,
  position,
  onClose,
  onVariantClick,
}: LineagePopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // Adjust position to stay in viewport
  useEffect(() => {
    if (popoverRef.current) {
      const rect = popoverRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let adjustedX = position.x - rect.width / 2;
      let adjustedY = position.y;

      if (adjustedX < 8) adjustedX = 8;
      if (adjustedX + rect.width > viewportWidth - 8) {
        adjustedX = viewportWidth - rect.width - 8;
      }

      if (adjustedY + rect.height > viewportHeight - 8) {
        adjustedY = position.y - rect.height - 80;
      }

      popoverRef.current.style.left = `${adjustedX}px`;
      popoverRef.current.style.top = `${adjustedY}px`;
    }
  }, [position]);

  // Build lineage tree
  const { parents, children } = useMemo(() => {
    const parents: LineageNode[] = [];
    const children: LineageNode[] = [];

    // Find parents (where this variant is the child)
    lineage
      .filter(l => l.child_variant_id === variant.id)
      .forEach(l => {
        const parentVariant = allVariants.find(v => v.id === l.parent_variant_id);
        if (parentVariant) {
          const parentAsset = allAssets.find(a => a.id === parentVariant.asset_id);
          if (parentAsset) {
            parents.push({
              variant: parentVariant,
              asset: parentAsset,
              relation: 'parent',
              lineageType: l.relation_type === 'spawned' ? 'spawned' : 'refined',
              severed: l.severed,
            });
          }
        }
      });

    // Find children (where this variant is the parent)
    lineage
      .filter(l => l.parent_variant_id === variant.id)
      .forEach(l => {
        const childVariant = allVariants.find(v => v.id === l.child_variant_id);
        if (childVariant) {
          const childAsset = allAssets.find(a => a.id === childVariant.asset_id);
          if (childAsset) {
            children.push({
              variant: childVariant,
              asset: childAsset,
              relation: 'child',
              lineageType: l.relation_type === 'spawned' ? 'spawned' : 'refined',
              severed: l.severed,
            });
          }
        }
      });

    return { parents, children };
  }, [variant.id, lineage, allVariants, allAssets]);

  const handleNodeClick = useCallback((node: LineageNode) => {
    onVariantClick?.(node.variant, node.asset);
    onClose();
  }, [onVariantClick, onClose]);

  const renderNode = (node: LineageNode) => (
    <button
      key={node.variant.id}
      className={`${styles.node} ${node.severed ? styles.severed : ''}`}
      onClick={() => handleNodeClick(node)}
    >
      <img
        src={`/api/images/${node.variant.thumb_key}`}
        alt={node.asset.name}
        className={styles.nodeThumbnail}
      />
      <div className={styles.nodeInfo}>
        <span className={styles.nodeName}>{node.asset.name}</span>
        <span className={styles.nodeType}>
          {node.lineageType === 'spawned' ? 'Forked' : 'Refined'}
          {node.severed && ' (severed)'}
        </span>
      </div>
      <span className={styles.nodeArrow}>
        {node.relation === 'parent' ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
            <path d="M12 5v14M5 12l7 7 7-7" />
          </svg>
        )}
      </span>
    </button>
  );

  const hasLineage = parents.length > 0 || children.length > 0;

  return (
    <div
      ref={popoverRef}
      className={styles.popover}
      style={{ left: position.x, top: position.y }}
    >
      <div className={styles.header}>
        <span className={styles.title}>Lineage</span>
      </div>

      {!hasLineage ? (
        <div className={styles.empty}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
          <span>No lineage for this variant</span>
        </div>
      ) : (
        <div className={styles.content}>
          {/* Parents */}
          {parents.length > 0 && (
            <div className={styles.section}>
              <span className={styles.sectionLabel}>
                Parents ({parents.length})
              </span>
              <div className={styles.nodes}>
                {parents.map(renderNode)}
              </div>
            </div>
          )}

          {/* Current variant */}
          <div className={styles.currentSection}>
            <div className={styles.current}>
              <img
                src={`/api/images/${variant.thumb_key}`}
                alt={asset.name}
                className={styles.currentThumbnail}
              />
              <div className={styles.currentInfo}>
                <span className={styles.currentName}>{asset.name}</span>
                <span className={styles.currentLabel}>Current variant</span>
              </div>
            </div>
          </div>

          {/* Children */}
          {children.length > 0 && (
            <div className={styles.section}>
              <span className={styles.sectionLabel}>
                Derived ({children.length})
              </span>
              <div className={styles.nodes}>
                {children.map(renderNode)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default LineagePopover;
