import { useState, useCallback } from 'react';
import styles from './LineageTree.module.css';

// Helper to get thumbnail URL with fallback to image_key
function getThumbnailUrl(variant: { thumb_key?: string; image_key: string }): string {
  return `/api/images/${variant.thumb_key || variant.image_key}`;
}

// Using a minimal variant type that works with the parent component
interface VariantMinimal {
  id: string;
  asset_id: string;
  image_key: string;
  thumb_key?: string;  // Optional: falls back to image_key
}

interface LineageNode {
  variant: VariantMinimal;
  relation_type: 'derived' | 'composed' | 'spawned';
  severed?: boolean;
  lineage_id?: string;  // For sever action
}

// Graph mode types
interface GraphVariant {
  id: string;
  asset_id: string;
  image_key: string;
  thumb_key?: string;  // Optional: falls back to image_key
  created_at: number;
  asset_name: string;
  asset_type: string;
}

interface GraphLineage {
  id: string;
  parent_variant_id: string;
  child_variant_id: string;
  relation_type: 'derived' | 'composed' | 'spawned';
  severed: boolean;
  created_at: number;
}

interface LineageTreeProps {
  currentVariant: VariantMinimal;
  parents: LineageNode[];
  children: LineageNode[];
  onSelectVariant: (variant: VariantMinimal) => void;
  onSeverLineage?: (lineageId: string) => void;
  spaceId?: string;
}

// Helper to get display text for relation type - user-friendly labels
const getRelationLabel = (type: string): string => {
  switch (type) {
    case 'derived': return 'Refined';
    case 'composed': return 'Composed';
    case 'spawned': return 'Forked';
    default: return type;
  }
};

const getRelationTooltip = (type: string, direction: 'parent' | 'child'): string => {
  if (direction === 'parent') {
    // This variant was created from the parent
    switch (type) {
      case 'derived': return 'Refined from this image';
      case 'composed': return 'Part of composition that created this';
      case 'spawned': return 'Forked from this to create new asset';
      default: return `Related via ${type}`;
    }
  } else {
    // The child was created from this variant
    switch (type) {
      case 'derived': return 'Was refined to create this';
      case 'composed': return 'Was used to compose this';
      case 'spawned': return 'Was forked to create new asset';
      default: return `Related via ${type}`;
    }
  }
};

export function LineageTree({
  currentVariant,
  parents,
  children,
  onSelectVariant,
  onSeverLineage,
  spaceId,
}: LineageTreeProps) {
  const [showGraph, setShowGraph] = useState(false);
  const [graphData, setGraphData] = useState<{
    variants: GraphVariant[];
    lineage: GraphLineage[];
  } | null>(null);
  const [isLoadingGraph, setIsLoadingGraph] = useState(false);

  const loadFullGraph = useCallback(async () => {
    if (!spaceId || isLoadingGraph) return;

    setIsLoadingGraph(true);
    try {
      const response = await fetch(
        `/api/spaces/${spaceId}/variants/${currentVariant.id}/lineage/graph`,
        { credentials: 'include' }
      );

      if (!response.ok) {
        throw new Error('Failed to load graph');
      }

      const data = await response.json() as {
        success: boolean;
        variants: GraphVariant[];
        lineage: GraphLineage[];
      };

      setGraphData({ variants: data.variants, lineage: data.lineage });
      setShowGraph(true);
    } catch (err) {
      console.error('Error loading lineage graph:', err);
    } finally {
      setIsLoadingGraph(false);
    }
  }, [spaceId, currentVariant.id, isLoadingGraph]);

  const toggleGraphMode = useCallback(() => {
    if (showGraph) {
      setShowGraph(false);
    } else {
      loadFullGraph();
    }
  }, [showGraph, loadFullGraph]);

  if (parents.length === 0 && children.length === 0) {
    return null;
  }

  // Build levels for graph visualization
  const buildGraphLevels = () => {
    if (!graphData) return { levels: [], edges: [] };

    const { variants, lineage } = graphData;
    const variantMap = new Map(variants.map(v => [v.id, v]));

    // Find roots (variants with no parents)
    const hasParent = new Set(lineage.map(l => l.child_variant_id));
    const roots = variants.filter(v => !hasParent.has(v.id));

    // BFS to assign levels
    const levels: GraphVariant[][] = [];
    const variantLevel = new Map<string, number>();
    const visited = new Set<string>();

    // Start from roots
    let currentLevel = roots.length > 0 ? roots : [variantMap.get(currentVariant.id)!];
    let levelIndex = 0;

    while (currentLevel.length > 0) {
      levels.push(currentLevel.filter(Boolean));
      currentLevel.forEach(v => {
        if (v) {
          variantLevel.set(v.id, levelIndex);
          visited.add(v.id);
        }
      });

      // Find next level (children of current level)
      const nextLevelIds = new Set<string>();
      for (const v of currentLevel) {
        if (!v) continue;
        for (const l of lineage) {
          if (l.parent_variant_id === v.id && !visited.has(l.child_variant_id)) {
            nextLevelIds.add(l.child_variant_id);
          }
        }
      }

      currentLevel = Array.from(nextLevelIds)
        .map(id => variantMap.get(id))
        .filter((v): v is GraphVariant => v !== undefined);
      levelIndex++;

      // Safety limit
      if (levelIndex > 20) break;
    }

    // Build edges with positions
    const edges = lineage.map(l => ({
      ...l,
      fromLevel: variantLevel.get(l.parent_variant_id) ?? 0,
      toLevel: variantLevel.get(l.child_variant_id) ?? 0,
    }));

    return { levels, edges, variantLevel };
  };

  // Render graph mode
  if (showGraph && graphData) {
    const { levels } = buildGraphLevels();

    // Group variants by asset for better visualization
    const assetGroups = new Map<string, GraphVariant[]>();
    for (const variant of graphData.variants) {
      const group = assetGroups.get(variant.asset_id) || [];
      group.push(variant);
      assetGroups.set(variant.asset_id, group);
    }

    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <h3 className={styles.title}>Full Lineage Graph</h3>
          <button className={styles.toggleButton} onClick={toggleGraphMode}>
            Show Direct Only
          </button>
        </div>

        <div className={styles.graphContainer}>
          <div className={styles.graphInfo}>
            {graphData.variants.length} variants across {assetGroups.size} assets
          </div>

          <div className={styles.graphLevels}>
            {levels.map((level, levelIdx) => (
              <div key={levelIdx} className={styles.graphLevel}>
                {levelIdx > 0 && (
                  <div className={styles.levelConnector}>
                    <svg viewBox="0 0 24 40" className={styles.levelArrow}>
                      <path d="M12 0v30M6 24l6 6 6-6" stroke="currentColor" strokeWidth="2" fill="none"/>
                    </svg>
                  </div>
                )}
                <div className={styles.levelNodes}>
                  {level.map((variant) => (
                    <div
                      key={variant.id}
                      className={`${styles.graphNode} ${variant.id === currentVariant.id ? styles.currentNode : ''}`}
                      onClick={() => onSelectVariant(variant)}
                      title={`${variant.asset_name} (${variant.asset_type})`}
                    >
                      <img
                        src={getThumbnailUrl(variant)}
                        alt={variant.asset_name}
                        className={styles.graphNodeImage}
                      />
                      <span className={styles.graphNodeLabel}>{variant.asset_name}</span>
                      {variant.id === currentVariant.id && (
                        <span className={styles.currentBadge}>Current</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Render simple tree mode
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.title}>Lineage</h3>
        {spaceId && (
          <button
            className={styles.toggleButton}
            onClick={toggleGraphMode}
            disabled={isLoadingGraph}
          >
            {isLoadingGraph ? 'Loading...' : 'Show Full Graph'}
          </button>
        )}
      </div>

      <div className={styles.tree}>
        {/* Parents (ancestors) */}
        {parents.length > 0 && (
          <div className={styles.section}>
            <span className={styles.sectionLabel}>Created from</span>
            <div className={styles.nodes}>
              {parents.map((node) => (
                <div
                  key={node.variant.id}
                  className={`${styles.node} ${node.severed ? styles.severed : ''}`}
                  onClick={() => onSelectVariant(node.variant)}
                  title={getRelationTooltip(node.relation_type, 'parent') + (node.severed ? ' (link severed)' : '')}
                >
                  <img
                    src={getThumbnailUrl(node.variant)}
                    alt="Parent variant"
                    className={styles.nodeImage}
                  />
                  <span className={`${styles.badge} ${styles[node.relation_type]}`}>
                    {getRelationLabel(node.relation_type)}
                  </span>
                  {node.severed && (
                    <span className={styles.severedBadge} title="Link severed">✂</span>
                  )}
                  {node.lineage_id && !node.severed && onSeverLineage && (
                    <button
                      className={styles.severButton}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSeverLineage(node.lineage_id!);
                      }}
                      title="Sever this lineage link"
                    >
                      ✂
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className={`${styles.connector} ${parents.some(p => p.severed) ? styles.severedConnector : ''}`}>
              <svg className={styles.arrow} viewBox="0 0 24 24" fill="none">
                <path d="M12 5v14M5 12l7 7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </div>
        )}

        {/* Current variant (center) */}
        <div className={styles.current}>
          <img
            src={getThumbnailUrl(currentVariant)}
            alt="Current variant"
            className={styles.currentImage}
          />
          <span className={styles.currentLabel}>Current</span>
        </div>

        {/* Children (descendants) */}
        {children.length > 0 && (
          <div className={styles.section}>
            <div className={`${styles.connector} ${children.some(c => c.severed) ? styles.severedConnector : ''}`}>
              <svg className={styles.arrow} viewBox="0 0 24 24" fill="none">
                <path d="M12 5v14M5 12l7 7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className={styles.sectionLabel}>Used to create</span>
            <div className={styles.nodes}>
              {children.map((node) => (
                <div
                  key={node.variant.id}
                  className={`${styles.node} ${node.severed ? styles.severed : ''}`}
                  onClick={() => onSelectVariant(node.variant)}
                  title={getRelationTooltip(node.relation_type, 'child') + (node.severed ? ' (link severed)' : '')}
                >
                  <img
                    src={getThumbnailUrl(node.variant)}
                    alt="Child variant"
                    className={styles.nodeImage}
                  />
                  <span className={`${styles.badge} ${styles[node.relation_type]}`}>
                    {getRelationLabel(node.relation_type)}
                  </span>
                  {node.severed && (
                    <span className={styles.severedBadge} title="Link severed">✂</span>
                  )}
                  {node.lineage_id && !node.severed && onSeverLineage && (
                    <button
                      className={styles.severButton}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSeverLineage(node.lineage_id!);
                      }}
                      title="Sever this lineage link"
                    >
                      ✂
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default LineageTree;
