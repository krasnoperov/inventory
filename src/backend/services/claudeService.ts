import Anthropic from '@anthropic-ai/sdk';
import type {
  ChatMessage,
  ForgeContext,
  ViewingContext,
  ToolCall,
  AdvisorResponse,
  BotResponse,
  PendingApproval,
  SimplePlan,
} from '../../api/types';
import { shouldAutoExecute, TOOL_TRUST_MAP } from './trustLevels';

// Re-export types for consumers
export type { ChatMessage, ForgeContext, ViewingContext, BotResponse };

// =============================================================================
// Image Generation Best Practices (injected into system prompt)
// =============================================================================

const IMAGE_GENERATION_GUIDE = `
IMAGE GENERATION BEST PRACTICES:

WHAT GEMINI EXCELS AT:
- Text rendering: Legible text in images (logos, signs, diagrams, infographics, UI mockups)
- World knowledge: Architectural styles, historical periods, real places, cultural references
- Multi-reference composition: Combining up to 14 images while maintaining element consistency
- Iterative refinement: Conversational editing with context preservation
- Contextual reasoning: Complex scenes with relationships between elements
- Professional output: High-resolution (up to 4K), control over lighting and camera angles

1. BE SPECIFIC IN PROMPTS
   Instead of generic descriptions, use detailed specifics:
   - Game characters: "Elven ranger with silver hair in a long braid, leaf-patterned leather armor, recurve bow, forest background, fantasy illustration style"
   - Game items: "Legendary fire sword with obsidian blade, molten cracks glowing orange, wrapped leather grip, RPG item art"
   - Architecture: "Red brick Victorian townhouse with bay windows, black iron railings, climbing ivy, overcast London sky"
   - Interiors: "Scandinavian living room with light oak flooring, white linen sofa, monstera in terracotta pot, north-facing window light"
   - People: "Woman in her 30s with shoulder-length black hair, navy blazer, confident expression, studio lighting"
   - Products: "Matte black ceramic coffee mug, cylindrical, 12oz, on white marble surface, soft diffused light"
   - Food: "Artisan sourdough loaf, golden crust with flour dusting, rustic wooden cutting board, warm kitchen lighting"
   - Fashion: "Oversized camel wool coat, double-breasted with tortoiseshell buttons, minimal white mannequin, editorial style"
   - Text/Graphics: "Vintage coffee shop logo, art deco style, 'MORNING BREW' text in gold serif font, circular badge design"
   - Infographics: "Step-by-step recipe diagram showing 4 stages of bread making, clean icons, minimal style, numbered steps"
   - UI/Mockups: "Mobile app login screen, modern minimal design, 'Welcome Back' heading, email and password fields, blue accent color"
   Include: subject, style, lighting, mood, composition, materials/textures

2. ONE STEP AT A TIME
   Change only ONE thing per refinement. Multiple changes = unpredictable results.

   Game example - Bad: "make the armor red, add a cape, and give them a different weapon"
   Good: Step 1: "Change armor to deep crimson" → Step 2: "Add flowing black cape" → Step 3: "Replace sword with battle axe"

   Interior example - Bad: "change sofa to blue, add coffee table, make it evening"
   Good: Step 1: "Change sofa to navy blue" → Step 2: "Add walnut coffee table" → Step 3: "Change to evening lighting"

3. VISUAL ANCHORS FOR CONSISTENCY
   Repeat exact phrases across prompts to maintain consistency:
   - Game characters: "silver hair in a long braid", "leaf-patterned leather armor", "glowing amber eyes"
   - Architecture: "red brick Victorian facade", "black iron railings", "bay windows"
   - Interiors: "light oak with visible grain", "white linen upholstery", "brushed brass hardware"
   - People: "woman with short silver hair and round glasses", "man in charcoal wool coat"
   - Products: "matte black ceramic", "white marble surface", "soft diffused studio light"
   - Food: "rustic wooden board", "fresh herb garnish", "warm kitchen lighting"
   - Fashion: "camel wool texture", "tortoiseshell buttons", "clean editorial lighting"
   - Logos/Branding: "gold serif font", "art deco geometric shapes", "circular badge design"
   - UI elements: "rounded corners 8px", "blue #2563EB accent", "SF Pro font style"
   - Art styles: "painterly fantasy illustration", "photorealistic", "editorial photography", "flat vector style"

4. EXPLICIT STATE CHANGES
   When modifying, be explicit about what changes:
   - Game: "Character now holding staff in right hand. Staff with crystal orb on top."
   - Game: "Remove helmet. Character's face now visible, same hairstyle."
   - Interior: "Add pendant light above dining table. Brass globe pendant centered."
   - Architecture: "Add climbing ivy on the left side of the facade."
   - People: "Person now seated at desk. Same outfit, seated position."
   - Food: "Add drizzle of olive oil on top. Oil pooling slightly."
   - Fashion: "Add silk scarf draped around the collar."

5. ENTITY REFERENCES IN COMBINES
   Be specific about which image contributes what:
   - Game: "The warrior from image 1 holding the sword from image 2, battle stance"
   - Interior: "The armchair from image 1 placed in the living room from image 2"
   - Architecture: "Building facade from image 1 with landscaping from image 2 in foreground"
   - Product: "The coffee mug from image 1 on the desk setup from image 2"
   - Fashion: "The coat from image 1 worn by the model from image 2"
   - NOT: "combine these" or "put them together"

6. STRUCTURED PROMPTS FOR COMPLEX SCENES
   For combines, structure clearly:
   - References: what each input image represents
   - Scene: the setting or environment
   - Subject: what goes where, spatial relationships
   - Lighting: direction, quality, time of day
   - Constraints: what must stay the same

   Example (game): "The mage from image 1 in the crystal cave from image 2. Center frame, casting pose. Keep cave's blue glow. Maintain exact robe design."
   Example (interior): "The armchair from image 1 in the sunroom from image 2. By the windows. Keep warm afternoon light and fabric texture."
   Example (product): "The mug from image 1 on the desk from image 2. Near keyboard. Keep cozy morning light and matte black finish."
   Example (food): "The sourdough from image 1 on the table setting from image 2. On wooden board. Keep warm kitchen light and golden crust."

7. POSITIVE DESCRIPTIONS WORK BETTER
   "Minimalist room with clean surfaces" works better than "remove the clutter"
   "Character with bare hands" works better than "remove the weapon"
   "Clear blue sky background" works better than "no clouds"
   Describe what you want, not what you don't want.

8. SPATIAL UNDERSTANDING
   Works well: placing characters in scenes, furniture in rooms, objects in hands, products on surfaces, food on plates, "next to", "in front of", "holding"
   Challenging: precise positioning, exact spacing, complex multi-character scenes, precise measurements
   Tip: Build complex scenes gradually - start with main subject, add environment, then secondary elements.

9. CONSISTENCY ACROSS A SERIES
   For consistent elements across multiple images:
   - Game characters: create "character sheet" (front/back/side), then use for action poses and scenes
   - Architecture: generate exterior, then use as reference for interior views or different angles
   - Interiors: generate base room, then use for different times of day or furniture arrangements
   - Products: generate hero shot, then combine with lifestyle scene backgrounds
   - Food: generate hero dish, then combine with different table settings
   - Fashion: generate garment, then combine with models or different contexts
   - Keep visual anchor phrases identical across all prompts
`;

// =============================================================================
// Usage Tracking Types
// =============================================================================

export interface ClaudeUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface BotResponseWithUsage {
  response: BotResponse;
  usage: ClaudeUsage;
}

/** Tool use block from Claude API for agentic loop */
export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Response for agentic loop - includes raw tool_use blocks */
export interface AgenticLoopResponse {
  /** Parsed response (may be partial if tools need execution) */
  response: BotResponse;
  /** Raw tool_use blocks for backend execution */
  toolUseBlocks: ToolUseBlock[];
  /** Text content from the response */
  textContent: string;
  /** Whether Claude wants to stop (stop_reason !== 'tool_use') */
  isComplete: boolean;
  /** Usage for billing */
  usage: ClaudeUsage;
  /** Raw content blocks for continuing the conversation */
  rawContent: Anthropic.ContentBlock[];
}

// =============================================================================
// Types (Extended for internal use)
// =============================================================================

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
  // Current markdown plan (if any)
  plan?: SimplePlan;
  // Personalization: learned patterns and preferences
  personalizationContext?: string;
}

// =============================================================================
// Tool Definitions
// =============================================================================

/**
 * READ_TOOLS: Tools for observing/analyzing assets without modification.
 * Available in both Advisor and Actor modes.
 */
const READ_TOOLS: Anthropic.Tool[] = [
  {
    name: 'search',
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
  {
    name: 'describe',
    description: 'Analyze an image. Use ONE reference method: slot (tray index), viewing (current view), or asset (by name). You cannot see images directly - always use this tool.',
    input_schema: {
      type: 'object' as const,
      properties: {
        slot: {
          type: 'number',
          description: 'Tray slot index (0, 1, 2...) - use to analyze a reference in the forge tray',
        },
        viewing: {
          type: 'boolean',
          description: 'Set to true to analyze what the user is currently viewing',
        },
        asset: {
          type: 'string',
          description: 'Asset name - use to analyze any asset by name',
        },
        question: {
          type: 'string',
          description: 'Question about the image. Examples: "What is the character wearing?", "Describe the lighting"',
        },
        focus: {
          type: 'string',
          enum: ['general', 'style', 'composition', 'details', 'prompt'],
          description: 'Analysis focus if no question: general overview, style, composition, details, or reverse-engineer prompt',
        },
      },
      required: [],
    },
  },
  {
    name: 'compare',
    description: 'Compare images. Use slots (tray indices) to specify which references to compare.',
    input_schema: {
      type: 'object' as const,
      properties: {
        slots: {
          type: 'array',
          items: { type: 'number' },
          description: 'Tray slot indices to compare (e.g., [0, 1] to compare first two slots)',
        },
        aspects: {
          type: 'array',
          items: { type: 'string' },
          description: 'Aspects to compare: style, composition, colors, details, mood',
        },
      },
      required: ['slots'],
    },
  },
  // Planning tool - available in both advisor and actor modes
  {
    name: 'update_plan',
    description: 'Update your working plan with markdown content. Use this to create or modify your plan as you work. The plan is visible to the user and helps track progress. Use markdown formatting with checkboxes for actionable items. Mark items as done using [x] when completed.',
    input_schema: {
      type: 'object' as const,
      properties: {
        content: {
          type: 'string',
          description: 'The markdown content for the plan. Use headers, bullet points, and checkboxes. Example:\n\n## Goal: Create a fantasy character set\n\n### Assets to generate:\n- [ ] Hero character - warrior with sword\n- [ ] Villain character - dark mage\n- [ ] Side character - merchant NPC\n\n### Notes:\n- Use consistent fantasy art style\n- Keep similar lighting across all',
        },
      },
      required: ['content'],
    },
  },
];

/**
 * ACTION_TOOLS: Tools that modify state (create, refine, combine assets, modify tray).
 * Only available in Actor mode.
 */
const ACTION_TOOLS: Anthropic.Tool[] = [
  {
    name: 'batch_generate',
    description: 'Generate multiple assets in parallel. Use this when the user wants several assets created at once. All generations will run simultaneously for faster results. Each item in the batch follows the same rules as the generate tool.',
    input_schema: {
      type: 'object' as const,
      properties: {
        requests: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Name for the new asset',
              },
              type: {
                type: 'string',
                enum: ['character', 'item', 'scene', 'prop', 'effect', 'ui'],
                description: 'Type of asset to generate',
              },
              prompt: {
                type: 'string',
                description: 'Detailed prompt describing what to generate',
              },
            },
            required: ['name', 'type', 'prompt'],
          },
          description: 'Array of generation requests to execute in parallel (2-5 items)',
          minItems: 2,
          maxItems: 5,
        },
      },
      required: ['requests'],
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
  // ==========================================================================
  // FORGE OPERATIONS (5 tools matching ForgeTray UI exactly)
  // ==========================================================================
  {
    name: 'generate',
    description: 'Generate a NEW asset from a text prompt only, with no reference images. Use this for pure text-to-image generation when starting from scratch.',
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
          description: 'Type of asset to generate',
        },
        prompt: {
          type: 'string',
          description: 'Detailed prompt describing what to generate. Include: subject, style, lighting, mood, composition.',
        },
        parentAssetId: {
          type: 'string',
          description: 'Optional: ID of parent asset if this is a child/derived asset',
        },
      },
      required: ['name', 'type', 'prompt'],
    },
  },
  {
    name: 'fork',
    description: 'Fork an existing asset to create an exact copy as a new asset. No AI generation - just duplicates the image. Use this to branch off a variant into its own asset for independent iteration.',
    input_schema: {
      type: 'object' as const,
      properties: {
        sourceAssetId: {
          type: 'string',
          description: 'The ID of the asset to fork (will use its active variant)',
        },
        name: {
          type: 'string',
          description: 'Name for the new forked asset',
        },
        type: {
          type: 'string',
          enum: ['character', 'item', 'scene', 'prop', 'effect', 'ui'],
          description: 'Type of the forked asset',
        },
        parentAssetId: {
          type: 'string',
          description: 'Optional: ID of parent asset in the hierarchy',
        },
      },
      required: ['sourceAssetId', 'name', 'type'],
    },
  },
  {
    name: 'derive',
    description: 'Derive a NEW asset using one or more reference images as inspiration. Use this for style transfer, element extraction, combining multiple references, or transforming existing images into something new. The references guide the AI but the result is a new creation.',
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
          description: 'Type of asset to derive',
        },
        prompt: {
          type: 'string',
          description: 'Prompt describing the transformation. For single ref: "Extract the gold coin", "Same character in anime style". For multiple refs: "Character from image 1 in scene from image 2", "Mug from image 1 on desk from image 2".',
        },
        referenceAssetIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Asset IDs to use as references (1-14). For multiple refs, order matters: image 1, image 2, etc.',
        },
        parentAssetId: {
          type: 'string',
          description: 'Optional: ID of parent asset if this is a child/derived asset',
        },
      },
      required: ['name', 'type', 'prompt', 'referenceAssetIds'],
    },
  },
  {
    name: 'refine',
    description: 'Refine an EXISTING asset by adding a new variant. The current image is automatically used as the source. Use this to iterate on an asset - changing colors, adding details, adjusting poses. IMPORTANT: Change only ONE thing at a time for best results.',
    input_schema: {
      type: 'object' as const,
      properties: {
        assetId: {
          type: 'string',
          description: 'The ID of the existing asset to refine',
        },
        prompt: {
          type: 'string',
          description: 'Prompt describing ONE specific change. Examples: "Change armor to deep crimson", "Add flowing black cape", "Remove helmet, face now visible". Use positive descriptions.',
        },
      },
      required: ['assetId', 'prompt'],
    },
  },
];

/** All tools combined for Actor mode */
const ALL_TOOLS: Anthropic.Tool[] = [...READ_TOOLS, ...ACTION_TOOLS];

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
   * Returns both the response and token usage for billing
   */
  async processMessage(
    userMessage: string,
    context: BotContext,
    history: ChatMessage[] = []
  ): Promise<BotResponseWithUsage> {
    const systemPrompt = this.buildSystemPrompt(context);

    const messages: Anthropic.MessageParam[] = [
      ...history.map(msg => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      })),
      { role: 'user', content: userMessage },
    ];

    // Select tools based on mode
    // Actor mode: All tools (read + action)
    // Advisor mode: Read tools only (search, describe, compare)
    const tools = context.mode === 'actor' ? ALL_TOOLS : READ_TOOLS;
    const maxTokens = context.mode === 'actor' ? 2048 : 1024;

    const response = await this.client.messages.create({
      model: 'claude-opus-4-5-20251101',
      max_tokens: maxTokens,
      system: systemPrompt,
      tools,
      messages,
    });

    return {
      response: this.parseToolResponse(response),
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  /**
   * Process message for agentic loop - returns raw tool_use blocks for backend execution.
   * Use this when you need to execute tools and continue the conversation.
   */
  async processMessageForAgenticLoop(
    userMessage: string,
    context: BotContext,
    history: ChatMessage[] = []
  ): Promise<AgenticLoopResponse> {
    const systemPrompt = this.buildSystemPrompt(context);

    const messages: Anthropic.MessageParam[] = [
      ...history.map(msg => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      })),
      { role: 'user', content: userMessage },
    ];

    const tools = context.mode === 'actor' ? ALL_TOOLS : READ_TOOLS;
    const maxTokens = context.mode === 'actor' ? 2048 : 1024;

    const response = await this.client.messages.create({
      model: 'claude-opus-4-5-20251101',
      max_tokens: maxTokens,
      system: systemPrompt,
      tools,
      messages,
    });

    return this.parseAgenticResponse(response);
  }

  /**
   * Continue agentic loop with tool results.
   * Sends assistant message + tool results back to Claude.
   */
  async continueWithToolResults(
    context: BotContext,
    conversationHistory: Anthropic.MessageParam[],
    assistantContent: Anthropic.ContentBlock[],
    toolResults: Anthropic.ToolResultBlockParam[]
  ): Promise<AgenticLoopResponse> {
    const systemPrompt = this.buildSystemPrompt(context);
    const tools = context.mode === 'actor' ? ALL_TOOLS : READ_TOOLS;
    const maxTokens = context.mode === 'actor' ? 2048 : 1024;

    // Build messages with assistant response and tool results
    const messages: Anthropic.MessageParam[] = [
      ...conversationHistory,
      { role: 'assistant', content: assistantContent },
      { role: 'user', content: toolResults },
    ];

    const response = await this.client.messages.create({
      model: 'claude-opus-4-5-20251101',
      max_tokens: maxTokens,
      system: systemPrompt,
      tools,
      messages,
    });

    return this.parseAgenticResponse(response);
  }

  /**
   * Parse Claude response for agentic loop
   */
  private parseAgenticResponse(response: Anthropic.Message): AgenticLoopResponse {
    const toolUseBlocks: ToolUseBlock[] = [];
    let textContent = '';

    for (const block of response.content) {
      if (block.type === 'text') {
        textContent += block.text;
      } else if (block.type === 'tool_use') {
        toolUseBlocks.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
      }
    }

    // Check if Claude wants to continue with tools
    const isComplete = response.stop_reason !== 'tool_use';

    return {
      response: this.parseToolResponse(response),
      toolUseBlocks,
      textContent,
      isComplete,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      rawContent: response.content,
    };
  }

  /**
   * Get tools for a given mode (exposed for workflow use)
   */
  getToolsForMode(mode: 'advisor' | 'actor'): Anthropic.Tool[] {
    return mode === 'actor' ? ALL_TOOLS : READ_TOOLS;
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
      const { operation = 'generate', slots = [], prompt: forgePrompt } = context.forge;
      // Include asset IDs so Claude can use them directly for derive/refine calls
      const slotList = slots.length > 0
        ? slots.map((s, i) => `[${i}] ${s.assetName} (id: ${s.assetId})`).join(', ')
        : '(empty)';
      prompt += `FORGE TRAY: ${slotList} | Prompt: ${forgePrompt ? `"${forgePrompt}"` : '(none)'} | Mode: ${operation.toUpperCase()}

`;
    }

    if (context.viewing) {
      const { type, assetName, variantCount, variantIndex } = context.viewing;
      if (type === 'asset' && assetName) {
        const variantInfo = variantCount && variantCount > 1
          ? ` (variant ${variantIndex || 1}/${variantCount})`
          : '';
        prompt += `VIEWING: "${assetName}"${variantInfo}

`;
      }
    }

    // Show current plan if exists
    if (context.plan) {
      const plan = context.plan;
      const statusLabel = plan.status === 'approved' ? ' [APPROVED]' : ' [DRAFT]';
      prompt += `YOUR CURRENT PLAN${statusLabel}:
\`\`\`markdown
${plan.content}
\`\`\`

Use update_plan to modify this plan as you work. Mark items as done with [x].
When ready to generate, use the appropriate tools (generate, derive, refine, batch_generate).
${plan.status === 'draft' ? 'The user can approve this plan before you proceed with generation.' : ''}

`;
    }

    // Inject personalization context (learned patterns)
    if (context.personalizationContext) {
      prompt += context.personalizationContext;
    }

    if (context.mode === 'advisor') {
      prompt += `MODE: ADVISOR (Read-only + Planning)

TOOLS:
- describe(slot: N) → analyze tray slot N
- describe(viewing: true) → analyze current view
- describe(asset: "Name") → analyze asset by name
- compare(slots: [0, 1]) → compare tray items
- search(query: "...") → find assets
- update_plan(content: "...") → create/update plan

IMPORTANT: You cannot see images directly. Use describe() to analyze any image.

${IMAGE_GENERATION_GUIDE}

Be helpful, creative, and concise.`;
    } else {
      prompt += `MODE: ACTOR (Tool Use Enabled)
You can take actions to help the user create and manage assets.

${IMAGE_GENERATION_GUIDE}

GUIDELINES:
1. For complex requests, use update_plan to write a markdown plan first
2. For multiple assets at once, use batch_generate (2-5 items in parallel)
3. For single actions, use the appropriate tool directly
4. Apply the best practices above when crafting prompts
5. For multi-step changes, break them into separate refine calls (one change per step)

PLANNING:
- Use update_plan to create/update your working plan as markdown
- Use checkboxes [ ] for items, mark done with [x]
- The plan is visible to the user in the UI
- You can update the plan anytime to track progress

COMMON WORKFLOWS:
- "Create a game character" → generate with appearance, armor, art style; then refine for character sheet variants
- "Create multiple characters" → update_plan with list, then batch_generate for parallel creation
- "Create a building" → generate with architecture style, materials, context; then refine for different angles/views
- "Create a room" → generate with style, materials, lighting; then refine furniture one piece at a time
- "Create a product shot" → generate on neutral background; then derive with lifestyle scene reference
- "Create food photography" → generate with plating and styling; then derive with table setting reference
- "Create fashion imagery" → generate on mannequin; then derive with model or context references
- "Create a logo" → generate with text, style, shape; Gemini excels at text rendering
- "Create an infographic" → generate with diagram structure, icons, text; leverage text rendering strength
- "Create UI mockup" → generate with screen layout, text labels, buttons; great for wireframes and concepts
- "Make variations" → refine with ONE specific change per call
- "Place element in scene" → derive: element from image 1 in environment from image 2
- "Equip/style subject" → derive: subject from image 1 with item/garment from image 2
- "Create series" → update_plan with list, batch_generate hero images, then refine for variants
- "Extract elements from scene" → derive with referenceAssetIds pointing to source scene

PROMPT QUALITY CHECKLIST:
✓ Specific subject (not "a building" but "Victorian townhouse with red brick and bay windows")
✓ Materials/textures (weathered leather, light oak grain, matte ceramic, golden crust)
✓ Style/aesthetic (fantasy illustration, photorealistic, editorial photography, pixel art)
✓ Lighting (dramatic rim lighting, soft diffused natural, warm kitchen light, studio)
✓ Visual anchors for consistency (exact phrases to reuse across prompts)

Always explain what you're doing and why.`;
    }

    return prompt;
  }

  /**
   * Parse tool response from Claude
   * Classifies tool calls by trust level for auto-execute vs approval
   */
  private parseToolResponse(response: Anthropic.Message): BotResponse {
    const safeToolCalls: ToolCall[] = [];
    const generatingToolCalls: ToolCall[] = [];
    let textContent = '';

    for (const block of response.content) {
      if (block.type === 'text') {
        textContent += block.text;
      } else if (block.type === 'tool_use') {
        // Classify tool by trust level
        const toolCall: ToolCall = {
          name: block.name,
          params: block.input as Record<string, unknown>,
        };

        if (shouldAutoExecute(block.name)) {
          safeToolCalls.push(toolCall);
        } else {
          generatingToolCalls.push(toolCall);
        }
      }
    }

    // If we have any tool calls, return action response with trust zone classification
    if (safeToolCalls.length > 0 || generatingToolCalls.length > 0) {
      // Convert generating tools to pending approvals
      const pendingApprovals: PendingApproval[] = generatingToolCalls.map((tc, index) => {
        const config = TOOL_TRUST_MAP[tc.name];
        return {
          id: `approval_${Date.now()}_${index}`,
          tool: tc.name,
          params: tc.params,
          description: config?.description || tc.name,
          status: 'pending' as const,
          createdAt: Date.now(),
        };
      });

      return {
        type: 'action',
        message: textContent || this.buildActionMessage(safeToolCalls, pendingApprovals),
        // Safe tools - caller should auto-execute these
        toolCalls: safeToolCalls.length > 0 ? safeToolCalls : undefined,
        // Generating tools - need user approval
        pendingApprovals: pendingApprovals.length > 0 ? pendingApprovals : undefined,
      };
    }

    // No tools used, return as advice
    return {
      type: 'advice',
      message: textContent || 'I understand. How can I help?',
    };
  }

  /**
   * Build a helpful message describing what actions will be taken
   */
  private buildActionMessage(safeCalls: ToolCall[], pendingApprovals: PendingApproval[]): string {
    const parts: string[] = [];

    if (safeCalls.length > 0) {
      const safeDescriptions = safeCalls.map(tc => {
        const config = TOOL_TRUST_MAP[tc.name];
        return config?.description || tc.name;
      });
      parts.push(`Executing: ${safeDescriptions.join(', ')}`);
    }

    if (pendingApprovals.length > 0) {
      const approvalDescriptions = pendingApprovals.map(pa => pa.description);
      parts.push(`Awaiting approval: ${approvalDescriptions.join(', ')}`);
    }

    return parts.join('. ') || 'Processing...';
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
   * Returns both the suggestion and token usage for billing
   */
  async suggestPrompt(
    context: BotContext,
    assetType: string,
    theme?: string
  ): Promise<{ suggestion: string; usage: ClaudeUsage }> {
    const prompt = theme
      ? `Generate a creative image prompt for a ${assetType} with the theme "${theme}". The prompt should be detailed and specific for AI image generation.`
      : `Generate a creative image prompt for a ${assetType}. Consider the existing assets in the space for consistency. The prompt should be detailed and specific for AI image generation.`;

    const response = await this.client.messages.create({
      model: 'claude-opus-4-5-20251101',
      max_tokens: 256,
      system: `You are a creative assistant helping generate prompts for AI image generation. Keep prompts concise but descriptive. Focus on visual details, style, and composition.`,
      messages: [{ role: 'user', content: prompt }],
    });

    return {
      suggestion: response.content[0].type === 'text'
        ? response.content[0].text
        : '',
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  /**
   * Enhance a prompt for Gemini image generation ("Geminify")
   * Adds style, lighting, technical details, color palette, texture, and atmosphere
   * Returns both the enhanced prompt and token usage for billing
   */
  async enhancePromptForGemini(
    originalPrompt: string
  ): Promise<{ enhancedPrompt: string; usage: ClaudeUsage }> {
    const systemPrompt = `You are a prompt enhancement specialist for AI image generation with Google Gemini.
Your job is to take a user's basic prompt and enhance it for optimal Gemini output.

ENHANCEMENT GUIDELINES:
1. PRESERVE the user's core intent and subject matter exactly
2. ADD rich visual details in these categories:
   - Style: art style, rendering technique, visual aesthetic
   - Lighting: direction, quality, mood, time of day
   - Color Palette: specific colors, saturation, contrast, harmony
   - Texture: surface qualities, materials, tactile details
   - Atmosphere: mood, environment, ambient elements
   - Technical: camera angle, framing, depth of field, focus
3. KEEP the enhanced prompt concise but detailed (aim for 50-100 words)
4. DO NOT add characters or elements the user didn't mention
5. DO NOT reference specific brands, studios, or copyrighted names
6. FORMAT as a single paragraph, ready for direct use

Return ONLY the enhanced prompt text, nothing else.`;

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: `Enhance this prompt for Gemini image generation:\n\n"${originalPrompt}"` }],
    });

    return {
      enhancedPrompt: response.content[0].type === 'text'
        ? response.content[0].text.trim()
        : originalPrompt,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  /**
   * Describe an image using multimodal Claude
   * Returns both the description and token usage for billing
   */
  async describeImage(
    imageBase64: string,
    mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
    assetName: string,
    focus: 'general' | 'style' | 'composition' | 'details' | 'compare' | 'prompt' = 'general',
    question?: string
  ): Promise<{ description: string; usage: ClaudeUsage }> {
    // System prompt to avoid brand/studio references
    const describeSystemPrompt = `You are an image analyst for a visual asset library. When describing images:
- NEVER reference specific studios, brands, or copyrighted names (e.g., no "Ghibli", "Disney", "Pixar", "Marvel", etc.)
- Instead, describe the actual visual characteristics: line quality, color palette, shading technique, rendering style
- Use generic art terminology: "soft watercolor shading", "cel-shaded", "painterly", "flat color", "detailed linework"
- Focus on what you actually see, not what it reminds you of
- Be accurate and objective in your descriptions`;

    // If a specific question is provided, use it directly
    if (question) {
      const userPrompt = `This is an image of "${assetName}" from a visual asset library.\n\nQuestion: ${question}\n\nPlease answer the question based on what you see in the image.`;

      const response = await this.client.messages.create({
        model: 'claude-opus-4-5-20251101',
        max_tokens: 1024,
        system: describeSystemPrompt,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: imageBase64,
              },
            },
            {
              type: 'text',
              text: userPrompt,
            },
          ],
        }],
      });

      return {
        description: response.content[0].type === 'text'
          ? response.content[0].text
          : 'Unable to analyze this image.',
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    }

    // Fallback to focus-based prompts
    const focusPrompts: Record<string, string> = {
      general: `Describe this image in detail. What do you see? Include the subject, setting, colors, mood, and any notable details.`,
      style: `Analyze the artistic style of this image. Describe the rendering technique, line quality, color palette, shading approach, and visual aesthetic using generic art terminology.`,
      composition: `Analyze the composition of this image. Describe the layout, focal points, use of space, visual balance, and how elements guide the viewer's eye.`,
      details: `Examine the fine details in this image. Look for textures, small elements, patterns, accessories, and subtle features that might be missed at first glance.`,
      compare: `Describe this image objectively, focusing on elements that could be compared to other versions or variants. Note specific visual features, poses, expressions, and distinguishing characteristics.`,
      prompt: `Reverse-engineer the generation prompt that could have created this image. Write a detailed text-to-image prompt that would reproduce this result. Include:
- Subject description (who/what, pose, expression, clothing/features)
- Art style (rendering technique, line quality, shading approach - use generic terms, not studio names)
- Color palette (specific colors, saturation, contrast)
- Lighting (direction, quality, mood)
- Composition (framing, camera angle, background)
- Any text or UI elements visible

Format your response as a ready-to-use generation prompt, not a description. Start directly with the prompt text.`,
    };

    const userPrompt = `This is an image of "${assetName}" from a visual asset library. ${focusPrompts[focus]}`;

    const response = await this.client.messages.create({
      model: 'claude-opus-4-5-20251101',
      max_tokens: 1024,
      system: describeSystemPrompt,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: imageBase64,
            },
          },
          {
            type: 'text',
            text: userPrompt,
          },
        ],
      }],
    });

    return {
      description: response.content[0].type === 'text'
        ? response.content[0].text
        : 'Unable to describe this image.',
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  /**
   * Compare multiple images using multimodal Claude
   * Returns both the comparison and token usage for billing
   */
  async compareImages(
    images: Array<{ base64: string; mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; label: string }>,
    aspects: string[] = ['style', 'composition', 'colors']
  ): Promise<{ comparison: string; usage: ClaudeUsage }> {
    // System prompt to avoid brand/studio references
    const compareSystemPrompt = `You are an image analyst for a visual asset library. When comparing images:
- NEVER reference specific studios, brands, or copyrighted names (e.g., no "Ghibli", "Disney", "Pixar", "Marvel", etc.)
- Instead, describe the actual visual characteristics: line quality, color palette, shading technique, rendering style
- Use generic art terminology: "soft watercolor shading", "cel-shaded", "painterly", "flat color", "detailed linework"
- Focus on what you actually see, not what it reminds you of
- Be accurate and objective in your comparisons`;

    const imageBlocks: Anthropic.ImageBlockParam[] = images.map((img) => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.mediaType,
        data: img.base64,
      },
    }));

    const labelList = images.map((img, i) => `Image ${i + 1}: "${img.label}"`).join('\n');
    const aspectList = aspects.join(', ');

    const response = await this.client.messages.create({
      model: 'claude-opus-4-5-20251101',
      max_tokens: 1024,
      system: compareSystemPrompt,
      messages: [{
        role: 'user',
        content: [
          ...imageBlocks,
          {
            type: 'text',
            text: `Compare these ${images.length} images from a visual asset library:
${labelList}

Focus on these aspects: ${aspectList}

For each aspect, describe similarities and differences between the images. Which elements are consistent? What changed between variants? Provide specific observations.`,
          },
        ],
      }],
    });

    return {
      comparison: response.content[0].type === 'text'
        ? response.content[0].text
        : 'Unable to compare these images.',
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}
