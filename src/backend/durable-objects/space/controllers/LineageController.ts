/**
 * Lineage Controller
 *
 * Handles lineage relationships between variants.
 * Supports direct parent/child queries and full graph traversal.
 */

import type { Lineage, WebSocketMeta } from '../types';
import type { LineageWithDetails } from '../repository/SpaceRepository';
import { buildLineageGraph, type GraphDependencies, type LineageGraph } from '../lineage/graph';
import { BaseController, type ControllerContext, NotFoundError } from './types';

export class LineageController extends BaseController {
  constructor(ctx: ControllerContext) {
    super(ctx);
  }

  /**
   * Handle lineage:sever WebSocket message
   * Severs a lineage relationship (marks as severed, doesn't delete)
   */
  async handleSever(ws: WebSocket, meta: WebSocketMeta, lineageId: string): Promise<void> {
    this.requireEditor(meta);

    const success = await this.repo.severLineage(lineageId);
    if (!success) {
      throw new NotFoundError('Lineage not found');
    }

    this.broadcast({ type: 'lineage:severed', lineageId });
  }

  /**
   * Handle GET /internal/lineage/:variantId HTTP request
   * Returns direct parents and children for a variant
   */
  async httpGetLineage(variantId: string): Promise<{
    parents: LineageWithDetails[];
    children: LineageWithDetails[];
  }> {
    const [parents, children] = await Promise.all([
      this.repo.getParentLineageWithDetails(variantId),
      this.repo.getChildLineageWithDetails(variantId),
    ]);

    return { parents, children };
  }

  /**
   * Handle GET /internal/lineage/:variantId/graph HTTP request
   * Returns full lineage graph (all connected variants via BFS)
   */
  async httpGetGraph(startVariantId: string): Promise<LineageGraph> {
    const deps: GraphDependencies = {
      getLineageForVariant: async (variantId) => {
        const result = await this.sql.exec(
          `SELECT * FROM lineage WHERE parent_variant_id = ? OR child_variant_id = ?`,
          variantId,
          variantId
        );
        return result.toArray() as Array<{
          id: string;
          parent_variant_id: string;
          child_variant_id: string;
          relation_type: string;
          severed: number;
          created_at: number;
        }>;
      },
      getVariantsWithAssets: async (variantIds) => {
        if (variantIds.length === 0) return [];
        const placeholders = variantIds.map(() => '?').join(',');
        const result = await this.sql.exec(
          `SELECT v.id, v.asset_id, v.thumb_key, v.image_key, v.created_at,
                  a.name as asset_name, a.type as asset_type
           FROM variants v
           JOIN assets a ON v.asset_id = a.id
           WHERE v.id IN (${placeholders})`,
          ...variantIds
        );
        return result.toArray() as Array<{
          id: string;
          asset_id: string;
          thumb_key: string;
          image_key: string;
          created_at: number;
          asset_name: string;
          asset_type: string;
        }>;
      },
    };

    return buildLineageGraph(startVariantId, deps);
  }

  /**
   * Handle POST /internal/add-lineage HTTP request
   * Creates a new lineage relationship (used by import)
   */
  async httpAddLineage(data: {
    parentVariantId: string;
    childVariantId: string;
    relationType: 'refined' | 'combined' | 'spawned';
  }): Promise<Lineage> {
    const lineage = await this.repo.createLineage({
      id: crypto.randomUUID(),
      parentVariantId: data.parentVariantId,
      childVariantId: data.childVariantId,
      relationType: data.relationType,
    });

    this.broadcast({ type: 'lineage:created', lineage });

    return lineage;
  }

  /**
   * Handle PATCH /internal/lineage/:id/sever HTTP request
   * Severs a lineage relationship via HTTP
   */
  async httpSever(lineageId: string): Promise<void> {
    const success = await this.repo.severLineage(lineageId);
    if (!success) {
      throw new NotFoundError('Lineage not found');
    }

    this.broadcast({ type: 'lineage:severed', lineageId });
  }
}
