import type { MediaKind } from '../shared/websocket-types';
import type { Asset, Variant } from './hooks/useSpaceWebSocket';

export interface ProductionRecord {
  id: string;
  production_id: string;
  variant_id: string;
  asset_id: string;
  media_kind: MediaKind;
  shot_id: string | null;
  scene_label: string;
  timeline_start_ms: number;
  duration_ms: number | null;
  motion_prompt: string | null;
  source_refs: string;
  source_variant_ids: string;
  metadata: string;
  created_by: string;
  created_at: number;
  updated_at: number;
}

export interface ProductionHandoffItem {
  recordId: string;
  productionId: string;
  shotId: string | null;
  sceneLabel: string;
  timelineStartMs: number;
  durationMs: number | null;
  motionPrompt: string | null;
  mediaKind: MediaKind;
  assetId: string;
  assetName: string;
  variantId: string;
  mediaUrl: string;
  webUrl: string;
  sourceRefs: string[];
  sourceVariantIds: string[];
  metadata: Record<string, unknown>;
}

export interface ProductionHandoff {
  version: 1;
  format: 'website-production-handoff';
  spaceId: string;
  productionId: string;
  generatedAt: string;
  records: ProductionHandoffItem[];
}

export function sortProductionRecords(records: ProductionRecord[]): ProductionRecord[] {
  return [...records].sort((a, b) => {
    if (a.timeline_start_ms !== b.timeline_start_ms) {
      return a.timeline_start_ms - b.timeline_start_ms;
    }
    const shotCompare = (a.shot_id || '').localeCompare(b.shot_id || '');
    if (shotCompare !== 0) return shotCompare;
    return a.created_at - b.created_at;
  });
}

export function parseJsonStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0);
  } catch {
    return [];
  }
}

export function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function createProductionHandoff(input: {
  spaceId: string;
  productionId: string;
  records: ProductionRecord[];
  assets: Asset[];
  variants: Variant[];
  baseUrl?: string;
  generatedAt?: Date;
}): ProductionHandoff {
  const assetById = new Map(input.assets.map(asset => [asset.id, asset]));
  const variantById = new Map(input.variants.map(variant => [variant.id, variant]));
  const origin = input.baseUrl?.replace(/\/$/, '') || '';

  return {
    version: 1,
    format: 'website-production-handoff',
    spaceId: input.spaceId,
    productionId: input.productionId,
    generatedAt: (input.generatedAt || new Date()).toISOString(),
    records: sortProductionRecords(input.records).map((record) => {
      const asset = assetById.get(record.asset_id);
      const variant = variantById.get(record.variant_id);
      return {
        recordId: record.id,
        productionId: record.production_id,
        shotId: record.shot_id,
        sceneLabel: record.scene_label,
        timelineStartMs: record.timeline_start_ms,
        durationMs: record.duration_ms,
        motionPrompt: record.motion_prompt,
        mediaKind: record.media_kind,
        assetId: record.asset_id,
        assetName: asset?.name || record.asset_id,
        variantId: record.variant_id,
        mediaUrl: `${origin}/api/spaces/${input.spaceId}/variants/${record.variant_id}/media`,
        webUrl: `${origin}/spaces/${input.spaceId}/assets/${record.asset_id}`,
        sourceRefs: parseJsonStringArray(record.source_refs),
        sourceVariantIds: parseJsonStringArray(record.source_variant_ids),
        metadata: {
          ...parseJsonObject(record.metadata),
          mediaKey: variant?.media_key || variant?.image_key || undefined,
          width: variant?.media_width ?? undefined,
          height: variant?.media_height ?? undefined,
          durationMs: variant?.media_duration_ms ?? undefined,
          mimeType: variant?.media_mime_type || undefined,
        },
      };
    }),
  };
}

export function formatTimelineOffset(ms: number): string {
  const safeMs = Math.max(0, Math.trunc(ms));
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millis = safeMs % 1000;
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return 'Open';
  return formatTimelineOffset(ms);
}

export function formatRemotionSceneArgs(handoff: ProductionHandoff): string {
  return handoff.records
    .filter(record => record.mediaKind === 'image' || record.mediaKind === 'video')
    .map(record => `--scene ${shellQuote(`${record.timelineStartMs}|${record.sceneLabel}|${record.mediaUrl}`)}`)
    .join('\n');
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
