import Anthropic from '@anthropic-ai/sdk';

// =============================================================================
// Types
// =============================================================================

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ForgeContextSlot {
  assetId: string;
  assetName: string;
  variantId: string;
}

export interface ForgeContext {
  operation: 'generate' | 'fork' | 'refine' | 'create' | 'combine';
  slots: ForgeContextSlot[];
  prompt: string;
}

export interface ViewingContext {
  type: 'catalog' | 'asset' | 'variant';
  assetId?: string;
  assetName?: string;
  variantId?: string;
}

export interface BotContext {
  spaceId: string;
  spaceName: string;
  assets: Array<{
    id: string;
    name: string;
    type: string;
    variantCount: number;
  }>;
  mode: 'advisor' | 'actor';
  // Forge Tray context
  forge?: ForgeContext;
  // What the user is currently viewing
  viewing?: ViewingContext;
}

export interface AdvisorResponse {
  type: 'advice';
  message: string;
  suggestions?: string[];
}

export interface ActorCommand {
  type: 'command';
  action: 'tray:add' | 'tray:remove' | 'tray:clear' | 'tray:setPrompt' | 'search:assets';
  params: Record<string, unknown>;
  explanation: string;
}

export type BotResponse = AdvisorResponse | ActorCommand;

// =============================================================================
// Claude Service - Bot Assistant Integration
// =============================================================================

export class ClaudeService {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  /**
   * Process a chat message and generate a response
   */
  async processMessage(
    userMessage: string,
    context: BotContext,
    history: ChatMessage[] = []
  ): Promise<BotResponse> {
    const systemPrompt = this.buildSystemPrompt(context);

    const messages: Anthropic.MessageParam[] = [
      ...history.map(msg => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      })),
      { role: 'user', content: userMessage },
    ];

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    });

    const responseText = response.content[0].type === 'text'
      ? response.content[0].text
      : '';

    // Parse the response based on mode
    if (context.mode === 'actor') {
      return this.parseActorResponse(responseText);
    }

    return this.parseAdvisorResponse(responseText);
  }

  /**
   * Build system prompt based on context and mode
   */
  private buildSystemPrompt(context: BotContext): string {
    let basePrompt = `You are an AI assistant helping users manage their visual asset inventory in a collaborative workspace called "${context.spaceName}".

Current assets in this space:
${context.assets.length > 0 ? context.assets.map(a => `- ${a.name} (${a.type}): ${a.variantCount} variants`).join('\n') : '(no assets yet)'}

`;

    // Add Forge Tray context if available
    if (context.forge) {
      const { operation, slots, prompt } = context.forge;
      basePrompt += `FORGE TRAY STATE:
- Operation: ${operation.toUpperCase()}
- References: ${slots.length > 0 ? slots.map(s => s.assetName).join(', ') : 'empty'}
- Current prompt: ${prompt ? `"${prompt}"` : '(none)'}

The Forge Tray is where users combine and transform assets. Operations:
- Generate: Create new asset from text prompt (0 refs)
- Fork: Copy asset as-is to new asset (1 ref, no prompt)
- Create: Transform ref into new asset (1 ref + prompt)
- Refine: Add variant to existing asset (1 ref + prompt)
- Combine: Merge multiple refs (2+ refs + prompt)

`;
    }

    // Add viewing context if available
    if (context.viewing) {
      const { type, assetName } = context.viewing;
      if (type === 'asset' && assetName) {
        basePrompt += `USER IS VIEWING: Asset "${assetName}"

`;
      } else if (type === 'catalog') {
        basePrompt += `USER IS VIEWING: Space catalog (all assets)

`;
      }
    }

    if (context.mode === 'advisor') {
      return basePrompt + `You are in ADVISOR mode. Your role is to:
- Answer questions about the assets and workflow
- Suggest creative prompts for the Forge Tray
- Recommend which assets to add as references
- Explain the different operations (Generate, Fork, Create, Refine, Combine)
- Help users achieve their creative goals

When suggesting prompts, be specific and visual. Consider the current tray state.
Respond conversationally and helpfully.`;
    }

    return basePrompt + `You are in ACTOR mode. You can take actions on behalf of the user.

Available actions:
1. tray:add - Add an asset to the Forge Tray
   Required: assetId (string)

2. tray:remove - Remove a slot from the Forge Tray
   Required: slotIndex (number)

3. tray:clear - Clear all slots from the Forge Tray

4. tray:setPrompt - Set the prompt in the Forge Tray
   Required: prompt (string)

5. search:assets - Search for assets by name or type
   Required: query (string)

When the user asks you to do something, respond in this JSON format:
{
  "action": "tray:add|tray:remove|tray:clear|tray:setPrompt|search:assets",
  "params": { /* action parameters */ },
  "explanation": "What you're doing and why"
}

If you need clarification before acting, just respond with a normal message asking for more details.
If the user's request doesn't require an action, respond conversationally.`;
  }

  /**
   * Parse response for advisor mode
   */
  private parseAdvisorResponse(text: string): AdvisorResponse {
    // Extract suggestions if present (lines starting with - or *)
    const lines = text.split('\n');
    const suggestions: string[] = [];
    const messageLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        suggestions.push(trimmed.slice(2));
      } else {
        messageLines.push(line);
      }
    }

    return {
      type: 'advice',
      message: messageLines.join('\n').trim(),
      suggestions: suggestions.length > 0 ? suggestions : undefined,
    };
  }

  /**
   * Parse response for actor mode
   */
  private parseActorResponse(text: string): BotResponse {
    // Try to extract JSON from the response
    const jsonMatch = text.match(/\{[\s\S]*?\}/);

    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.action && parsed.params) {
          return {
            type: 'command',
            action: parsed.action,
            params: parsed.params,
            explanation: parsed.explanation || 'Executing action...',
          };
        }
      } catch {
        // Not valid JSON, treat as advice
      }
    }

    // If no valid command, return as advice
    return {
      type: 'advice',
      message: text,
    };
  }

  /**
   * Generate a creative prompt suggestion based on context
   */
  async suggestPrompt(
    context: BotContext,
    assetType: string,
    theme?: string
  ): Promise<string> {
    const prompt = theme
      ? `Generate a creative image prompt for a ${assetType} with the theme "${theme}". The prompt should be detailed and specific for AI image generation.`
      : `Generate a creative image prompt for a ${assetType}. Consider the existing assets in the space for consistency. The prompt should be detailed and specific for AI image generation.`;

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      system: `You are a creative assistant helping generate prompts for AI image generation. Keep prompts concise but descriptive. Focus on visual details, style, and composition.`,
      messages: [{ role: 'user', content: prompt }],
    });

    return response.content[0].type === 'text'
      ? response.content[0].text
      : '';
  }
}
