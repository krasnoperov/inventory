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
  forge?: ForgeContext;
  viewing?: ViewingContext;
  // Current plan being executed
  activePlan?: AssistantPlan;
}

// =============================================================================
// Plan Types
// =============================================================================

export interface PlanStep {
  id: string;
  description: string;
  action: string;
  params: Record<string, unknown>;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  result?: string;
  error?: string;
}

export interface AssistantPlan {
  id: string;
  goal: string;
  steps: PlanStep[];
  currentStepIndex: number;
  status: 'planning' | 'executing' | 'completed' | 'failed' | 'paused';
  createdAt: number;
}

// =============================================================================
// Response Types
// =============================================================================

export interface AdvisorResponse {
  type: 'advice';
  message: string;
  suggestions?: string[];
}

export interface ToolCall {
  name: string;
  params: Record<string, unknown>;
}

export interface ActorResponse {
  type: 'action';
  toolCalls: ToolCall[];
  message: string;
}

export interface PlanResponse {
  type: 'plan';
  plan: AssistantPlan;
  message: string;
}

export type BotResponse = AdvisorResponse | ActorResponse | PlanResponse;

// =============================================================================
// Tool Definitions
// =============================================================================

const ASSISTANT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'create_plan',
    description: 'Create a multi-step plan to achieve the user\'s goal. Use this when the user wants to create multiple assets, do a series of operations, or achieve a complex creative goal. The plan will be shown to the user for approval before execution.',
    input_schema: {
      type: 'object' as const,
      properties: {
        goal: {
          type: 'string',
          description: 'A clear description of what this plan will achieve',
        },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              description: {
                type: 'string',
                description: 'Human-readable description of this step',
              },
              action: {
                type: 'string',
                enum: ['generate_asset', 'refine_asset', 'combine_assets', 'add_to_tray', 'set_prompt', 'clear_tray'],
                description: 'The action to perform',
              },
              params: {
                type: 'object',
                description: 'Parameters for the action',
              },
            },
            required: ['description', 'action', 'params'],
          },
          description: 'The steps to execute in order',
        },
      },
      required: ['goal', 'steps'],
    },
  },
  {
    name: 'add_to_tray',
    description: 'Add an existing asset to the Forge Tray as a reference. The tray can hold up to 14 references.',
    input_schema: {
      type: 'object' as const,
      properties: {
        assetId: {
          type: 'string',
          description: 'The ID of the asset to add',
        },
        assetName: {
          type: 'string',
          description: 'The name of the asset (for confirmation)',
        },
      },
      required: ['assetId', 'assetName'],
    },
  },
  {
    name: 'remove_from_tray',
    description: 'Remove an asset from the Forge Tray by slot index (0-based)',
    input_schema: {
      type: 'object' as const,
      properties: {
        slotIndex: {
          type: 'number',
          description: 'The index of the slot to remove (0-based)',
        },
      },
      required: ['slotIndex'],
    },
  },
  {
    name: 'clear_tray',
    description: 'Clear all references from the Forge Tray',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'set_prompt',
    description: 'Set the generation prompt in the Forge Tray',
    input_schema: {
      type: 'object' as const,
      properties: {
        prompt: {
          type: 'string',
          description: 'The prompt text for image generation',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'generate_asset',
    description: 'Generate a new asset from scratch using a text prompt. This creates a brand new asset in the space.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Name for the new asset',
        },
        type: {
          type: 'string',
          enum: ['character', 'item', 'scene', 'prop', 'effect', 'ui'],
          description: 'Type of asset to create',
        },
        prompt: {
          type: 'string',
          description: 'Detailed prompt describing the image to generate',
        },
        parentAssetId: {
          type: 'string',
          description: 'Optional: ID of parent asset if this is a child',
        },
      },
      required: ['name', 'type', 'prompt'],
    },
  },
  {
    name: 'refine_asset',
    description: 'Add a new variant to an existing asset by refining it with a prompt',
    input_schema: {
      type: 'object' as const,
      properties: {
        assetId: {
          type: 'string',
          description: 'The ID of the asset to refine',
        },
        prompt: {
          type: 'string',
          description: 'Prompt describing how to modify/refine the asset',
        },
      },
      required: ['assetId', 'prompt'],
    },
  },
  {
    name: 'combine_assets',
    description: 'Combine multiple asset references into a new asset or variant',
    input_schema: {
      type: 'object' as const,
      properties: {
        sourceAssetIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'IDs of assets to combine (2 or more)',
        },
        prompt: {
          type: 'string',
          description: 'Prompt describing how to combine the assets',
        },
        targetName: {
          type: 'string',
          description: 'Name for the combined result (if creating new asset)',
        },
        targetType: {
          type: 'string',
          enum: ['character', 'item', 'scene', 'prop', 'effect', 'ui'],
          description: 'Type of the combined asset',
        },
      },
      required: ['sourceAssetIds', 'prompt', 'targetName', 'targetType'],
    },
  },
  {
    name: 'search_assets',
    description: 'Search for assets in the space by name, type, or description',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query (matches asset names and types)',
        },
      },
      required: ['query'],
    },
  },
];

// =============================================================================
// Claude Service - Bot Assistant Integration
// =============================================================================

export class ClaudeService {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  /**
   * Process a chat message and generate a response with tool use
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

    // Use tool calling for actor mode
    if (context.mode === 'actor') {
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        system: systemPrompt,
        tools: ASSISTANT_TOOLS,
        messages,
      });

      return this.parseToolResponse(response);
    }

    // Simple text response for advisor mode
    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    });

    const responseText = response.content[0].type === 'text'
      ? response.content[0].text
      : '';

    return this.parseAdvisorResponse(responseText);
  }

  /**
   * Build system prompt based on context
   */
  private buildSystemPrompt(context: BotContext): string {
    let prompt = `You are the Forge Assistant, an AI creative collaborator helping users manage visual assets in "${context.spaceName}".

CURRENT ASSETS IN SPACE:
${context.assets.length > 0
  ? context.assets.map(a => `- ${a.name} (id: ${a.id}, type: ${a.type}, variants: ${a.variantCount})`).join('\n')
  : '(no assets yet)'}

`;

    if (context.forge) {
      const { operation, slots, prompt: forgePrompt } = context.forge;
      prompt += `FORGE TRAY STATE:
- Current operation: ${operation.toUpperCase()}
- References in tray: ${slots.length > 0 ? slots.map((s, i) => `[${i}] ${s.assetName}`).join(', ') : 'empty'}
- Prompt: ${forgePrompt ? `"${forgePrompt}"` : '(none)'}

Operations explained:
- GENERATE: Create from prompt only (0 refs)
- FORK: Duplicate as new asset (1 ref, no prompt)
- CREATE: Transform ref to new asset (1 ref + prompt)
- REFINE: Add variant to ref's asset (1 ref + prompt)
- COMBINE: Merge refs into new (2+ refs + prompt)

`;
    }

    if (context.viewing) {
      const { type, assetName } = context.viewing;
      prompt += `USER IS VIEWING: ${type === 'asset' ? `Asset "${assetName}"` : 'Space catalog'}\n\n`;
    }

    if (context.activePlan) {
      const plan = context.activePlan;
      prompt += `ACTIVE PLAN: "${plan.goal}"
Status: ${plan.status}
Progress: Step ${plan.currentStepIndex + 1} of ${plan.steps.length}
Steps:
${plan.steps.map((s, i) => `${i + 1}. [${s.status}] ${s.description}${s.result ? ` → ${s.result}` : ''}`).join('\n')}

`;
    }

    if (context.mode === 'advisor') {
      prompt += `MODE: ADVISOR
- Answer questions about assets and creative workflow
- Suggest prompts and techniques
- Explain operations and best practices
- Help users understand their options

Be helpful, creative, and concise.`;
    } else {
      prompt += `MODE: ACTOR (Tool Use Enabled)
You can take actions to help the user create and manage assets.

GUIDELINES:
1. For complex requests (multiple assets, series, collections), use create_plan to make a step-by-step plan
2. For simple single actions, use the appropriate tool directly
3. Always confirm understanding before taking destructive actions
4. Be creative with prompts - make them detailed and visually specific
5. When generating prompts, consider: composition, lighting, style, mood, details

COMMON WORKFLOWS:
- "Create a character" → generate_asset with detailed prompt
- "Make variations" → refine_asset with modification prompts
- "Create a set/collection" → create_plan with multiple generate_asset steps
- "Combine these" → combine_assets with the references

Always explain what you're doing and why.`;
    }

    return prompt;
  }

  /**
   * Parse tool response from Claude
   */
  private parseToolResponse(response: Anthropic.Message): BotResponse {
    const toolCalls: ToolCall[] = [];
    let textContent = '';

    for (const block of response.content) {
      if (block.type === 'text') {
        textContent += block.text;
      } else if (block.type === 'tool_use') {
        // Check if this is a plan creation
        if (block.name === 'create_plan') {
          const input = block.input as { goal: string; steps: Array<{ description: string; action: string; params: Record<string, unknown> }> };
          const plan: AssistantPlan = {
            id: `plan_${Date.now()}`,
            goal: input.goal,
            steps: input.steps.map((s, i) => ({
              id: `step_${i}`,
              description: s.description,
              action: s.action,
              params: s.params,
              status: 'pending' as const,
            })),
            currentStepIndex: 0,
            status: 'planning',
            createdAt: Date.now(),
          };

          return {
            type: 'plan',
            plan,
            message: textContent || `I've created a plan to: ${input.goal}`,
          };
        }

        // Regular tool call
        toolCalls.push({
          name: block.name,
          params: block.input as Record<string, unknown>,
        });
      }
    }

    if (toolCalls.length > 0) {
      return {
        type: 'action',
        toolCalls,
        message: textContent || 'Executing actions...',
      };
    }

    // No tools used, return as advice
    return {
      type: 'advice',
      message: textContent || 'I understand. How can I help?',
    };
  }

  /**
   * Parse advisor response
   */
  private parseAdvisorResponse(text: string): AdvisorResponse {
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
   * Generate a creative prompt suggestion
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
