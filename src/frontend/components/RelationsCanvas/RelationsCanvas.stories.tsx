import type { Story, StoryDefault } from '../../component-stories/ladle-types';
import { makeAsset, makeVariant } from '../../component-stories/fixtures';
import type {
  CompositionItem,
  CollectionItem,
  Lineage,
  SpaceCollection,
  SpaceRelation,
  Variant,
} from '../../space/protocol';
import type { CompositionLike } from './relationsModel';
import { RelationsCanvas } from './RelationsCanvas';

export default { title: 'Components / RelationsCanvas' } satisfies StoryDefault;

// A believable small space: cast threaded by lineage, scenes/props cross-linked
// by authored relations, and a deliverable composition pulling members together.
function space() {
  const variants: Variant[] = [];
  const ready = (assetId: string, w = 400, h = 400, starred = false): Variant => {
    const v = makeVariant({ asset_id: assetId, status: 'completed', image_key: `${assetId}.png`, thumb_key: `${assetId}-t.png`, media_width: w, media_height: h, starred });
    variants.push(v);
    return v;
  };
  const placeholder = (assetId: string, status: Variant['status']): Variant => {
    const v = makeVariant({ asset_id: assetId, status });
    variants.push(v);
    return v;
  };

  const knight = makeAsset({ id: 'knight', name: 'Knight', type: 'character', tags: '["hero","melee"]' });
  const kv1 = ready('knight'); ready('knight', 400, 400, true); placeholder('knight', 'processing');
  knight.active_variant_id = kv1.id;

  const knightArmored = makeAsset({ id: 'knight-armored', name: 'Knight · Plate', type: 'character', tags: '["hero"]' });
  const kav = ready('knight-armored'); placeholder('knight-armored', 'failed');
  knightArmored.active_variant_id = kav.id;

  const knightSprite = makeAsset({ id: 'knight-sprite', name: 'Knight Sheet', type: 'sprite-sheet' });
  const ksv = ready('knight-sprite', 512, 384); knightSprite.active_variant_id = ksv.id;

  const mage = makeAsset({ id: 'mage', name: 'Mage', type: 'character', tags: '["hero","caster"]' });
  const mv = ready('mage', 400, 480, true); mage.active_variant_id = mv.id;

  const sword = makeAsset({ id: 'sword', name: 'Runeblade', type: 'item', tags: '["weapon"]' });
  const sv = ready('sword', 200, 460); sword.active_variant_id = sv.id;

  const forest = makeAsset({ id: 'forest', name: 'Lost Woods', type: 'scene', tags: '["exterior"]' });
  const fv = ready('forest', 640, 360); forest.active_variant_id = fv.id;

  const ruins = makeAsset({ id: 'ruins', name: 'Old Ruins', type: 'scene' });
  const rv = ready('ruins', 640, 360); ruins.active_variant_id = rv.id;

  const styleRef = makeAsset({ id: 'style', name: 'Ink Wash', type: 'style-sheet' });
  const stv = ready('style', 400, 400); styleRef.active_variant_id = stv.id;

  const map = makeAsset({ id: 'map', name: 'Region Map', type: 'reference' });
  const mpv = ready('map', 512, 512); map.active_variant_id = mpv.id;

  const assets = [knight, knightArmored, knightSprite, mage, sword, forest, ruins, styleRef, map];

  const lineage: Lineage[] = [
    { id: 'l1', parent_variant_id: kv1.id, child_variant_id: kav.id, relation_type: 'refined', severed: false, created_at: 1 },
    { id: 'l2', parent_variant_id: kav.id, child_variant_id: ksv.id, relation_type: 'derived', severed: false, created_at: 2 },
    { id: 'l3', parent_variant_id: stv.id, child_variant_id: mv.id, relation_type: 'forked', severed: false, created_at: 3 },
  ];

  const rel = (id: string, s: string, o: string, type: SpaceRelation['relation_type']): SpaceRelation => ({
    id, subject_type: 'asset', subject_asset_id: s, subject_variant_id: null,
    object_type: 'asset', object_asset_id: o, object_variant_id: null,
    relation_type: type, context: null, sort_index: 0, created_by: 'u', created_at: 1, updated_at: 1,
  });
  const relations: SpaceRelation[] = [
    rel('r1', 'knight', 'forest', 'appears_in'),
    rel('r2', 'mage', 'forest', 'appears_in'),
    rel('r3', 'sword', 'knight', 'prop_in'),
    rel('r4', 'style', 'mage', 'style_reference_for'),
    rel('r5', 'map', 'ruins', 'map_for'),
  ];

  const collections: SpaceCollection[] = [
    { id: 'c-cast', name: 'Cast', kind: 'cast', color: null, description: null, sort_index: 0, created_at: 1, updated_at: 1 },
    { id: 'c-bg', name: 'Backgrounds', kind: 'backgrounds', color: null, description: null, sort_index: 1, created_at: 1, updated_at: 1 },
    { id: 'c-style', name: 'Style Refs', kind: 'style_refs', color: null, description: null, sort_index: 2, created_at: 1, updated_at: 1 },
  ];
  const ci = (id: string, c: string, a: string): CollectionItem => ({
    id, collection_id: c, subject_type: 'asset', asset_id: a, variant_id: null, role: '', pinned_variant_id: null, sort_index: 0, created_by: 'u', created_at: 1, updated_at: 1,
  });
  const collectionItems: CollectionItem[] = [
    ci('i1', 'c-cast', 'knight'), ci('i2', 'c-cast', 'knight-armored'), ci('i3', 'c-cast', 'mage'), ci('i4', 'c-cast', 'knight-sprite'),
    ci('i5', 'c-bg', 'forest'), ci('i6', 'c-bg', 'ruins'),
    ci('i7', 'c-style', 'style'),
  ];

  const compositions: CompositionLike[] = [
    { id: 'comp-1', name: 'Key Art', status: 'draft' },
  ];
  const compositionItems: CompositionItem[] = [
    { id: 'm1', composition_id: 'comp-1', role: 'background', asset_id: 'forest', variant_id: fv.id, metadata: '{}', sort_index: 0, created_by: 'u', created_at: 1, updated_at: 1 },
    { id: 'm2', composition_id: 'comp-1', role: 'character', asset_id: 'knight', variant_id: kv1.id, metadata: '{}', sort_index: 1, created_by: 'u', created_at: 1, updated_at: 1 },
    { id: 'm3', composition_id: 'comp-1', role: 'character', asset_id: 'mage', variant_id: mv.id, metadata: '{}', sort_index: 2, created_by: 'u', created_at: 1, updated_at: 1 },
  ];

  return { assets, variants, lineage, relations, collections, collectionItems, compositions, compositionItems };
}

export const Default: Story = () => {
  const s = space();
  return (
    <div style={{ position: 'relative', width: '100%', height: '88vh', border: '1px solid var(--color-border)', borderRadius: 12, overflow: 'hidden' }}>
      <RelationsCanvas spaceId="space-1" onAssetClick={() => {}} {...s} />
    </div>
  );
};
