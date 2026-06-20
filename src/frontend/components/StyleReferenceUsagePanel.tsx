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

  return (
    <div className={styles.panel}>
      <strong>Style reference usage</strong>
      {collections.length > 0 && (
        <div>
          <span>Collections</span>
          {collections.map((collection) => (
            <small key={collection.id}>{collection.name}</small>
          ))}
        </div>
      )}
      {presets.length > 0 && (
        <div>
          <span>Presets</span>
          {presets.map((preset) => (
            <small key={preset.id}>{preset.name}</small>
          ))}
        </div>
      )}
      {outputs.length > 0 && (
        <div>
          <span>Generated outputs</span>
          {outputs.map((output) => (
            <Link key={output.id} to={`/spaces/${spaceId}/assets/${output.id}`}>{output.name}</Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default StyleReferenceUsagePanel;
