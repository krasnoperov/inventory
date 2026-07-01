import { Link } from './Link';
import type { Asset, SpaceCollection, StylePresetRaw } from '../space/protocol';
import styles from './StyleReferenceUsagePanel.module.css';

export interface StyleReferenceUsagePanelProps {
  spaceId: string;
  collections: SpaceCollection[];
  presets: StylePresetRaw[];
  outputs: Asset[];
}

export function StyleReferenceUsagePanel({
  spaceId,
  collections,
  presets,
  outputs,
}: StyleReferenceUsagePanelProps) {
  if (collections.length === 0 && presets.length === 0 && outputs.length === 0) {
    return null;
  }
  const usageCount = collections.length + presets.length + outputs.length;

  return (
    <section className={styles.panel} aria-label="Style reference usage">
      <div className={styles.header}>
        <h2 className={styles.title}>
          Style usage
          <span className={styles.countBadge}>{usageCount}</span>
        </h2>
      </div>
      {collections.length > 0 && (
        <div className={styles.group}>
          <div className={styles.groupTitle}>Collections</div>
          <div className={styles.items}>
            {collections.map((collection) => (
              <span key={collection.id} className={styles.item}>{collection.name}</span>
            ))}
          </div>
        </div>
      )}
      {presets.length > 0 && (
        <div className={styles.group}>
          <div className={styles.groupTitle}>Presets</div>
          <div className={styles.items}>
            {presets.map((preset) => (
              <span key={preset.id} className={styles.item}>{preset.name}</span>
            ))}
          </div>
        </div>
      )}
      {outputs.length > 0 && (
        <div className={styles.group}>
          <div className={styles.groupTitle}>Outputs</div>
          <div className={styles.items}>
            {outputs.map((output) => (
              <Link key={output.id} className={styles.itemLink} to={`/spaces/${spaceId}/assets/${output.id}`}>{output.name}</Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export default StyleReferenceUsagePanel;
