import { injectable, inject } from 'inversify';
import { MemoryDAO } from '../../dao/memory-dao';
import type { UserPattern, UserPreferences } from '../../db/types';

/**
 * Service for managing assistant memory: patterns, feedback, and preferences.
 * Provides context injection for personalized AI responses.
 */
@injectable()
export class MemoryService {
  constructor(
    @inject(MemoryDAO) private memoryDAO: MemoryDAO
  ) {}

  // ==========================================================================
  // PATTERN CAPTURE
  // ==========================================================================

  /**
   * Capture a successful pattern when user generates/refines an asset
   */
  async capturePattern(params: {
    userId: number;
    spaceId?: string;
    prompt: string;
    assetType: string;
    styleTags?: string[];
  }): Promise<string> {
    const promptHash = await this.hashPrompt(params.prompt);

    return await this.memoryDAO.upsertPattern({
      userId: params.userId,
      spaceId: params.spaceId ?? null,
      assetType: params.assetType,
      promptText: params.prompt,
      promptHash,
      styleTags: params.styleTags,
    });
  }

  /**
   * Hash a prompt for deduplication
   */
  private async hashPrompt(prompt: string): Promise<string> {
    // Normalize: lowercase, trim, remove extra spaces
    const normalized = prompt.toLowerCase().trim().replace(/\s+/g, ' ');
    const encoder = new TextEncoder();
    const data = encoder.encode(normalized);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ==========================================================================
  // CONTEXT BUILDING
  // ==========================================================================

  /**
   * Get relevant patterns for context injection into Claude
   */
  async getRelevantPatterns(
    userId: number,
    options?: { assetType?: string; spaceId?: string; limit?: number }
  ): Promise<UserPattern[]> {
    const prefs = await this.memoryDAO.getPreferences(userId);

    if (!prefs.inject_patterns) {
      return [];
    }

    const limit = options?.limit ?? prefs.max_patterns_context;
    return await this.memoryDAO.getPatterns(userId, {
      assetType: options?.assetType,
      spaceId: options?.spaceId,
      limit,
    });
  }

  /**
   * Build a context string for Claude system prompt injection
   */
  buildPatternContext(patterns: UserPattern[]): string {
    if (patterns.length === 0) {
      return '';
    }

    const lines = patterns.map((p) => {
      const truncatedPrompt = p.prompt_text.length > 60
        ? p.prompt_text.slice(0, 60) + '...'
        : p.prompt_text;
      const usageInfo = p.success_count > 1 ? ` (used ${p.success_count}x)` : '';
      return `- "${truncatedPrompt}" [${p.asset_type}]${usageInfo}`;
    });

    return [
      '',
      'USER\'S SUCCESSFUL PATTERNS:',
      ...lines,
      'Consider these patterns when suggesting prompts or generating assets.',
      '',
    ].join('\n');
  }

  /**
   * Get full personalization context for Claude
   */
  async getPersonalizationContext(userId: number, spaceId?: string): Promise<{
    patternContext: string;
    preferences: UserPreferences;
  }> {
    const [patterns, preferences] = await Promise.all([
      this.getRelevantPatterns(userId, { spaceId }),
      this.memoryDAO.getPreferences(userId),
    ]);

    return {
      patternContext: this.buildPatternContext(patterns),
      preferences,
    };
  }

  // ==========================================================================
  // FEEDBACK
  // ==========================================================================

  /**
   * Record user feedback on a variant
   */
  async recordFeedback(params: {
    userId: number;
    variantId: string;
    rating: 'positive' | 'negative';
    prompt?: string;
  }): Promise<string> {
    const feedbackId = await this.memoryDAO.recordFeedback(params);

    // If positive feedback with a prompt, also capture as pattern
    if (params.rating === 'positive' && params.prompt) {
      // Extract asset type from prompt heuristics (can be enhanced later)
      const assetType = this.inferAssetType(params.prompt);
      await this.capturePattern({
        userId: params.userId,
        prompt: params.prompt,
        assetType,
      });
    }

    return feedbackId;
  }

  /**
   * Infer asset type from prompt (basic heuristics)
   */
  private inferAssetType(prompt: string): string {
    const lower = prompt.toLowerCase();

    if (lower.includes('character') || lower.includes('person') || lower.includes('knight') ||
        lower.includes('hero') || lower.includes('villain') || lower.includes('warrior')) {
      return 'character';
    }
    if (lower.includes('forest') || lower.includes('scene') || lower.includes('landscape') ||
        lower.includes('background') || lower.includes('environment') || lower.includes('dungeon')) {
      return 'scene';
    }
    if (lower.includes('sword') || lower.includes('weapon') || lower.includes('armor') ||
        lower.includes('item') || lower.includes('potion') || lower.includes('artifact')) {
      return 'object';
    }
    if (lower.includes('monster') || lower.includes('creature') || lower.includes('dragon') ||
        lower.includes('beast') || lower.includes('demon')) {
      return 'creature';
    }
    if (lower.includes('ui') || lower.includes('button') || lower.includes('icon') ||
        lower.includes('interface') || lower.includes('menu')) {
      return 'ui';
    }

    return 'general';
  }

  // ==========================================================================
  // PREFERENCES
  // ==========================================================================

  /**
   * Get user preferences
   */
  async getPreferences(userId: number): Promise<UserPreferences> {
    return await this.memoryDAO.getPreferences(userId);
  }

  /**
   * Update user preferences
   */
  async updatePreferences(userId: number, updates: {
    default_art_style?: string | null;
    default_aspect_ratio?: string | null;
    auto_execute_safe?: boolean;
    auto_approve_low_cost?: boolean;
    inject_patterns?: boolean;
    max_patterns_context?: number;
  }): Promise<void> {
    await this.memoryDAO.updatePreferences(userId, updates);
  }

  // ==========================================================================
  // PATTERN MANAGEMENT
  // ==========================================================================

  /**
   * Get all user patterns for the preferences panel
   */
  async getUserPatterns(userId: number): Promise<UserPattern[]> {
    return await this.memoryDAO.getPatterns(userId, { limit: 100 });
  }

  /**
   * Delete (forget) a pattern
   */
  async deletePattern(userId: number, patternId: string): Promise<boolean> {
    return await this.memoryDAO.deletePattern(userId, patternId);
  }

  /**
   * Get feedback stats for user dashboard
   */
  async getFeedbackStats(userId: number): Promise<{ positive: number; negative: number }> {
    return await this.memoryDAO.getFeedbackStats(userId);
  }
}
