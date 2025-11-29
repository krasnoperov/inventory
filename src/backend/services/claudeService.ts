import Anthropic from '@anthropic-ai/sdk';
import type {
  ChatMessage,
  ForgeContext,
  ViewingContext,
  ToolCall,
  AssistantPlan,
  AdvisorResponse,
  BotResponse,
  PendingApproval,
} from '../../api/types';
import { shouldAutoExecute, getTrustLevel, TOOL_TRUST_MAP } from './trustLevels';

// Re-export types for consumers
export type { ChatMessage, ForgeContext, ViewingContext, BotResponse };

// =============================================================================
// Image Generation Best Practices (injected into system prompt)
// =============================================================================

const IMAGE_GENERATION_GUIDE = `
IMAGE GENERATION BEST PRACTICES:

1. BE SPECIFIC IN PROMPTS
   Instead of generic descriptions, use detailed specifics:
   - Architecture: "A mid-century modern house with floor-to-ceiling windows, flat roof, and cantilevered second floor, desert landscape"
   - Interiors: "Scandinavian living room with light oak flooring, white linen sofa, monstera plant in terracotta pot, north-facing window light"
   - Characters: "A woman in her 30s with shoulder-length black hair, wearing a navy blazer, confident expression"
   - Products: "Matte black ceramic coffee mug, cylindrical, 12oz, on white marble surface"
   Include: subject, style, lighting, mood, composition, materials/textures

2. ONE STEP AT A TIME
   Change only ONE thing per refinement. Multiple changes = unpredictable results.

   Bad: "change the sofa to blue, add a coffee table, and make it evening lighting"
   Good: Step 1: "Change sofa upholstery to navy blue" → Step 2: "Add walnut coffee table in front of sofa" → Step 3: "Change to warm evening lighting from table lamps"

   Bad: "make the building taller with more windows and different materials"
   Good: Step 1: "Add two more floors to the building" → Step 2: "Add floor-to-ceiling windows on new floors" → Step 3: "Change facade material to weathered copper panels"

3. VISUAL ANCHORS FOR CONSISTENCY
   Repeat exact phrases across prompts to maintain consistency:
   - Architecture: "red brick Victorian facade", "industrial steel-frame windows", "polished concrete floors"
   - People: "woman with short silver hair and round glasses", "man in charcoal wool coat"
   - Style: "soft diffused natural light from large windows", "warm golden hour sunlight", "overcast flat lighting"
   - Materials: "white oak with visible grain", "brushed brass hardware", "matte black metal frame"

4. EXPLICIT STATE CHANGES
   When modifying, be explicit about what changes:
   - "Add a pendant light above the dining table. Brass globe pendant centered over table."
   - "Remove the rug. Hardwood floor now visible throughout the room."
   - "Replace the curtains with wooden blinds. White wooden venetian blinds on all windows."
   - "The person is now seated at the desk. Same outfit, seated position."

5. ENTITY REFERENCES IN COMBINES
   Be specific about which image contributes what:
   - "The sofa from image 1 placed in the living room from image 2, against the main wall"
   - "The person from image 1 standing in the office space from image 2, near the window"
   - "The building facade from image 1 with the landscaping from image 2 in the foreground"
   - "Use the color palette from image 1 but the room layout from image 2"
   - NOT: "combine these" or "put them together"

6. STRUCTURED PROMPTS FOR COMPLEX SCENES
   For combines, structure clearly:
   - References: what each input image represents
   - Scene: the setting or environment
   - Subject: what goes where, spatial relationships
   - Lighting: direction, quality, time of day
   - Constraints: what must stay the same

   Example: "The modern armchair from image 1 placed in the sunroom from image 2. Position armchair in the corner by the windows. Maintain the warm afternoon lighting from image 2. Keep the chair's exact fabric texture and walnut legs."

7. POSITIVE DESCRIPTIONS WORK BETTER
   "Minimalist room with clean surfaces" works better than "remove the clutter"
   "Clear blue sky" works better than "no clouds"
   Describe what you want, not what you don't want.

8. SPATIAL UNDERSTANDING
   Works well: placing furniture in rooms, objects on surfaces, people in environments, "next to", "in front of", "on the wall"
   Challenging: precise measurements, exact spacing, complex multi-object arrangements
   Tip: Build complex scenes gradually - start with the room, add major furniture, then accessories.

9. CONSISTENCY ACROSS A SERIES
   For consistent elements across multiple images:
   - Create a "reference sheet" first (multiple angles, detail shots)
   - Architecture: generate exterior, then use as reference for interior views
   - Products: generate hero shot, then use for lifestyle/context images
   - People: generate a clear portrait first, then use for different scenes/poses
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
  // Current plan being executed
  activePlan?: AssistantPlan;
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
  {
    name: 'describe_image',
    description: 'Analyze and describe what is in a variant image. Use this when the user asks what is in an image, wants you to analyze a generated result, or needs a detailed description of a variant. IMPORTANT: Use this tool whenever asked to describe, analyze, or look at an image - you cannot see images without calling this tool.',
    input_schema: {
      type: 'object' as const,
      properties: {
        variantId: {
          type: 'string',
          description: 'The ID of the variant to analyze',
        },
        assetName: {
          type: 'string',
          description: 'The name of the asset (for context)',
        },
        question: {
          type: 'string',
          description: 'The specific question to answer about the image. Pass through the user\'s question or your own analytical question. Examples: "What separate assets can we extract from this scene?", "What is the character wearing?", "Describe the lighting and mood."',
        },
        focus: {
          type: 'string',
          enum: ['general', 'style', 'composition', 'details', 'compare'],
          description: 'Optional fallback focus if no question provided: general overview, artistic style, composition, fine details, or comparison to prompt',
        },
      },
      required: ['variantId', 'assetName'],
    },
  },
  {
    name: 'compare_variants',
    description: 'Compare two or more variants of the same or different assets, highlighting differences and similarities.',
    input_schema: {
      type: 'object' as const,
      properties: {
        variantIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'IDs of variants to compare (2-4)',
        },
        aspectsToCompare: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['style', 'composition', 'colors', 'details', 'mood'],
          },
          description: 'Aspects to focus comparison on',
        },
      },
      required: ['variantIds'],
    },
  },
];

/**
 * ACTION_TOOLS: Tools that modify state (create, refine, combine assets, modify tray).
 * Only available in Actor mode.
 */
const ACTION_TOOLS: Anthropic.Tool[] = [
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
    description: 'Generate a new asset from scratch using a text prompt. Creates a brand new asset in the space. PROMPT TIPS: Be specific - include subject, style, lighting, mood, materials. Use visual anchors (exact phrases to reuse for consistency). Examples: "Scandinavian living room with light oak floors, white linen sofa, monstera in terracotta pot, soft north-facing window light" or "Woman in her 30s, shoulder-length black hair, navy blazer, confident expression, studio lighting" or "Mid-century modern house, floor-to-ceiling windows, flat roof, desert landscape, golden hour"',
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
          description: 'Detailed prompt. Include: subject with specifics, style/aesthetic, lighting, mood, materials/textures. Use phrases you can repeat for consistency (visual anchors like "light oak flooring", "industrial steel windows", "warm afternoon light").',
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
    description: 'Add a new variant to an existing asset by refining it with a prompt. IMPORTANT: Change only ONE thing at a time for best results. Multiple changes = unpredictable results. Be explicit about state changes. Use positive descriptions rather than negative.',
    input_schema: {
      type: 'object' as const,
      properties: {
        assetId: {
          type: 'string',
          description: 'The ID of the asset to refine',
        },
        prompt: {
          type: 'string',
          description: 'Prompt describing ONE specific change. Examples: "Change sofa upholstery to navy blue velvet", "Add pendant light above the dining table", "Change time of day to sunset with warm orange light", "Person now seated at the desk, same outfit". For removals: "Remove the rug. Hardwood floor visible throughout."',
        },
      },
      required: ['assetId', 'prompt'],
    },
  },
  {
    name: 'combine_assets',
    description: 'Combine multiple asset references into a new asset. IMPORTANT: Use explicit entity references - say exactly what comes from which image. Structure prompt with: what each image provides, spatial relationships, lighting, and what must stay the same. Works best with 2-4 references.',
    input_schema: {
      type: 'object' as const,
      properties: {
        sourceAssetIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'IDs of assets to combine (2-4 recommended). Order matters for entity references.',
        },
        prompt: {
          type: 'string',
          description: 'Structured combination prompt. Examples: "The armchair from image 1 placed in the living room from image 2, positioned by the window, maintain the warm afternoon lighting" or "The person from image 1 standing in the office from image 2, near the desk, same outfit and pose" or "Building facade from image 1 with the landscaping from image 2 in foreground, golden hour lighting". Always specify: what from each image, where it goes, lighting, what to preserve.',
        },
        targetName: {
          type: 'string',
          description: 'Name for the combined result',
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
      model: 'claude-sonnet-4-20250514',
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
      const { type, assetName, variantId, variantCount, variantIndex } = context.viewing;
      if (type === 'asset' && assetName) {
        const variantInfo = variantCount && variantCount > 0
          ? ` (viewing variant ${variantIndex || 1} of ${variantCount}${variantId ? `, variantId: ${variantId}` : ''})`
          : '';
        prompt += `USER IS VIEWING: Asset "${assetName}"${variantInfo}
To describe this image, use the describe_image tool with variantId="${variantId}" and assetName="${assetName}".

`;
      } else {
        prompt += `USER IS VIEWING: Space catalog\n\n`;
      }
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

    // Inject personalization context (learned patterns)
    if (context.personalizationContext) {
      prompt += context.personalizationContext;
    }

    if (context.mode === 'advisor') {
      prompt += `MODE: ADVISOR (Read Tools Available)
You can observe and analyze assets, but cannot modify them.

AVAILABLE TOOLS:
- describe_image: Analyze what's in an image. ALWAYS use this when asked to describe, look at, or analyze any image. You cannot see images without calling this tool.
- compare_variants: Compare multiple variants side-by-side
- search_assets: Find assets by name or type

IMPORTANT: When the user asks you to describe what they're viewing or asks about an image, you MUST use the describe_image tool. Do not say you cannot see images - use the tool!

GUIDELINES:
- Answer questions about assets and creative workflow
- Suggest prompts and techniques using the best practices below
- Explain operations and best practices
- Help users understand their options

${IMAGE_GENERATION_GUIDE}

Be helpful, creative, and concise.`;
    } else {
      prompt += `MODE: ACTOR (Tool Use Enabled)
You can take actions to help the user create and manage assets.

${IMAGE_GENERATION_GUIDE}

GUIDELINES:
1. For complex requests (multiple assets, series, collections), use create_plan to make a step-by-step plan
2. For simple single actions, use the appropriate tool directly
3. Always confirm understanding before taking destructive actions
4. Apply the best practices above when crafting prompts
5. For multi-step changes, break them into separate refine_asset calls (one change per step)

COMMON WORKFLOWS:
- "Create a room/space" → generate_asset with detailed prompt (style, materials, lighting, furniture)
- "Create a character/person" → generate_asset with appearance details, then create reference variants
- "Make variations" → refine_asset with ONE specific change per call
- "Redesign the space" → create_plan with sequential refine_asset steps (one change each)
- "Place furniture in room" → combine_assets with furniture from image 1 in room from image 2
- "Create a photo collage" → combine_assets with explicit entity references for each element
- "Create architectural views" → create_plan: generate exterior, then interior views using exterior as reference
- "Product lifestyle shots" → create_plan: generate product, then combine with different scene backgrounds

PROMPT QUALITY CHECKLIST:
✓ Specific subject (not "a room" but "Scandinavian living room with light oak floors")
✓ Materials/textures (white linen, brushed brass, polished concrete)
✓ Style/aesthetic (mid-century modern, industrial, minimalist, photorealistic)
✓ Lighting (soft north-facing window light, warm golden hour, studio lighting)
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
      model: 'claude-sonnet-4-20250514',
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
   * Describe an image using multimodal Claude
   * Returns both the description and token usage for billing
   */
  async describeImage(
    imageBase64: string,
    mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
    assetName: string,
    focus: 'general' | 'style' | 'composition' | 'details' | 'compare' = 'general',
    question?: string
  ): Promise<{ description: string; usage: ClaudeUsage }> {
    // If a specific question is provided, use it directly
    if (question) {
      const userPrompt = `This is an image of "${assetName}" from a visual asset library.\n\nQuestion: ${question}\n\nPlease answer the question based on what you see in the image.`;

      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
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
      style: `Analyze the artistic style of this image. Describe the art style, techniques used, color palette, and visual aesthetic. Compare to known art styles if applicable.`,
      composition: `Analyze the composition of this image. Describe the layout, focal points, use of space, visual balance, and how elements guide the viewer's eye.`,
      details: `Examine the fine details in this image. Look for textures, small elements, patterns, accessories, and subtle features that might be missed at first glance.`,
      compare: `Describe this image objectively, focusing on elements that could be compared to other versions or variants. Note specific visual features, poses, expressions, and distinguishing characteristics.`,
    };

    const userPrompt = `This is an image of "${assetName}" from a visual asset library. ${focusPrompts[focus]}`;

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
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
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
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
