# Forge Assistant Integration Plan

## Overview

Enhance the existing ChatSidebar to become a **Forge Assistant** - an AI-powered collaborator that can observe, suggest, control, and review the Forge Tray workflow. The assistant should feel like a knowledgeable creative partner who understands your asset library and can help execute your vision.

---

## Requirements: What the Assistant Can Do

### 1. **Context Awareness**
- See what's currently in the Forge Tray (slots, prompt)
- Know which asset/variant the user is viewing
- Access the full asset catalog for the space
- Remember conversation history within the session

### 2. **Suggestion Capabilities**
- **Prompt suggestions**: Generate creative prompts based on user's description or intent
- **Asset recommendations**: "For a forest scene, you might want to add your 'Ancient Oak' asset"
- **Style guidance**: "Based on your style guide, I'd suggest adding warm lighting"
- **Workflow tips**: "You have 3 character variants - want me to combine them?"

### 3. **Image Understanding**
- **Describe images**: Analyze and describe what's in a variant/asset
- **Compare variants**: "V2 has more dramatic lighting than V1"
- **Identify elements**: "I see a sword in this image - want to extract it?"

### 4. **Catalog Search**
- Find relevant assets by description: "Show me all the forest-related assets"
- Results appear as clickable thumbnails in chat
- User can click to add directly to Forge Tray

### 5. **Forge Tray Control**
- **Add to tray**: "Adding 'Hero Knight' to the tray"
- **Set prompt**: "I've set the prompt to: epic battle scene..."
- **Clear tray**: "Cleared the tray for a fresh start"
- **Trigger generation**: "Starting generation now..."

### 6. **Result Review**
- Automatically describe newly generated images
- Compare result to the prompt intent
- Suggest refinements: "The pose looks good, but we could add more dramatic lighting"

---

## UI Design

### Layout Integration

The assistant panel should work alongside (not replace) the Forge Tray:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  SPACE: Fantasy RPG                                    [🤖 Assistant] [⚙️]  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────┐  ┌──────────────────────────┐ │
│  │                                         │  │  FORGE ASSISTANT         │ │
│  │                                         │  │                          │ │
│  │           ASSET GRID                    │  │  [Context: Viewing Hero] │ │
│  │                                         │  │  [Tray: 2 items]         │ │
│  │                                         │  │                          │ │
│  │                                         │  │  ─────────────────────── │ │
│  │                                         │  │                          │ │
│  │                                         │  │  User: I want to create  │ │
│  │                                         │  │  a battle-ready version  │ │
│  │                                         │  │                          │ │
│  │                                         │  │  🤖: I can help! Your    │ │
│  │                                         │  │  Hero has great base     │ │
│  │                                         │  │  design. Here's a prompt │ │
│  │                                         │  │  suggestion:             │ │
│  │                                         │  │                          │ │
│  │                                         │  │  [Apply Prompt]          │ │
│  │                                         │  │                          │ │
│  │                                         │  │  Related assets:         │ │
│  │                                         │  │  [🗡️ Sword] [🛡️ Shield]  │ │
│  │                                         │  │                          │ │
│  └─────────────────────────────────────────┘  │  ─────────────────────── │ │
│                                               │  [Type message...]    [↑]│ │
│                                               └──────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────────────┤
│  [ref] [ref] [+]  │  "battle-ready pose..."                    [Transform]  │
└─────────────────────────────────────────────────────────────────────────────┘
                              FORGE TRAY (always visible)
```

### Assistant Panel Components

#### 1. **Context Bar** (top of panel)
```
┌──────────────────────────────────────┐
│ 📍 Viewing: Hero Knight              │
│ 🔥 Tray: Knight v2, Style Guide      │
└──────────────────────────────────────┘
```
- Shows current viewing context
- Shows Forge Tray contents at a glance
- Updates in real-time as user navigates

#### 2. **Message Types**

**User Message**:
```
┌──────────────────────────────────────┐
│ I want to create a winter version    │
│ of this character                    │
└──────────────────────────────────────┘
```

**Assistant Text Response**:
```
┌──────────────────────────────────────┐
│ 🤖 Great idea! I can see your Hero   │
│ has detailed armor. For a winter     │
│ version, I suggest:                  │
│                                      │
│ "Hero knight in snow-covered armor,  │
│ frost crystals on pauldrons, breath  │
│ visible in cold air, winter storm    │
│ background"                          │
│                                      │
│ [📋 Copy] [✨ Apply to Tray]         │
└──────────────────────────────────────┘
```

**Asset Suggestion Cards**:
```
┌──────────────────────────────────────┐
│ 🤖 Here are some assets that might   │
│ work well:                           │
│                                      │
│ ┌─────┐ ┌─────┐ ┌─────┐             │
│ │[img]│ │[img]│ │[img]│             │
│ │Snow │ │Ice  │ │Frost│             │
│ │Scene│ │Crown│ │Sword│             │
│ │ [+] │ │ [+] │ │ [+] │             │
│ └─────┘ └─────┘ └─────┘             │
└──────────────────────────────────────┘
```

**Action Confirmation**:
```
┌──────────────────────────────────────┐
│ 🤖 ✓ Added "Frost Sword" to tray     │
│                                      │
│ Tray now has: Knight v2, Style,      │
│ Frost Sword                          │
│                                      │
│ Ready to combine? [🔀 Combine Now]   │
└──────────────────────────────────────┘
```

**Generation Progress**:
```
┌──────────────────────────────────────┐
│ 🤖 ⏳ Generating your winter knight...│
│                                      │
│ ████████████░░░░░░░░ 60%            │
│                                      │
│ Using: Knight v2 + Style + Sword     │
│ Prompt: "Hero knight in snow..."     │
└──────────────────────────────────────┘
```

**Result Review**:
```
┌──────────────────────────────────────┐
│ 🤖 ✨ Generation complete!            │
│                                      │
│ ┌────────────────────────────┐      │
│ │                            │      │
│ │     [Generated Image]      │      │
│ │                            │      │
│ └────────────────────────────┘      │
│                                      │
│ The result captures the winter       │
│ theme well. The frost details on     │
│ the armor came out nicely. The pose  │
│ is dynamic.                          │
│                                      │
│ Want to refine? Try:                 │
│ • "Add more snow particles"          │
│ • "Make armor more ice-like"         │
│                                      │
│ [👍 Keep] [🔄 Refine] [🗑️ Discard]   │
└──────────────────────────────────────┘
```

#### 3. **Quick Actions Bar** (above input)
```
┌──────────────────────────────────────┐
│ [💡 Suggest] [🔍 Find] [📝 Describe] │
└──────────────────────────────────────┘
```
- **Suggest**: Generate prompt based on current context
- **Find**: Search catalog with natural language
- **Describe**: Analyze current image/variant

#### 4. **Input Area**
```
┌──────────────────────────────────────┐
│ [Type message or command...]     [↑] │
└──────────────────────────────────────┘
```
- Auto-expand for longer messages
- Cmd+Enter to send
- Slash commands: `/add`, `/clear`, `/generate`

---

## Implementation Architecture

### Phase 1: Enhanced Context Sharing

**Goal**: Assistant knows about Forge Tray state

```typescript
// New: ForgeTray context for Claude
interface ForgeContext {
  tray: {
    slots: Array<{
      assetId: string;
      assetName: string;
      variantId: string;
      variantNumber: number;
      thumbnailUrl: string;
    }>;
    prompt: string;
    operation: 'generate' | 'transform' | 'combine';
  };
  viewing: {
    type: 'catalog' | 'asset' | 'variant';
    assetId?: string;
    assetName?: string;
    variantId?: string;
  };
  recentActivity: string[]; // Last 5 actions
}
```

**API Enhancement** (`POST /api/spaces/:id/chat`):
```typescript
// Request body extension
{
  message: string;
  mode: 'advisor' | 'actor';
  history: Message[];
  forgeContext: ForgeContext;  // NEW
}
```

**Claude System Prompt Extension**:
```
Current Forge Tray State:
- Operation Mode: {operation}
- Slots: {slots.map(s => s.assetName).join(', ') || 'empty'}
- Current Prompt: "{prompt || 'none'}"

User is currently viewing: {viewing.type} - {viewing.assetName || 'catalog'}
```

### Phase 2: Tray Control Actions

**Goal**: Assistant can manipulate the Forge Tray

**New Actor Commands**:
```typescript
type AssistantAction =
  | { action: 'tray:add'; params: { assetId: string; variantId?: string } }
  | { action: 'tray:remove'; params: { slotId: string } }
  | { action: 'tray:clear' }
  | { action: 'tray:setPrompt'; params: { prompt: string } }
  | { action: 'tray:generate' }
  | { action: 'search:assets'; params: { query: string } }
  | { action: 'describe:image'; params: { variantId: string } };
```

**Frontend Action Handler**:
```typescript
// In ChatSidebar or new AssistantPanel
const handleAssistantAction = (action: AssistantAction) => {
  switch (action.action) {
    case 'tray:add':
      const asset = assets.find(a => a.id === action.params.assetId);
      const variant = variants.find(v => v.id === action.params.variantId);
      if (asset && variant) {
        forgeTrayStore.addSlot(variant, asset);
      }
      break;
    case 'tray:setPrompt':
      forgeTrayStore.setPrompt(action.params.prompt);
      break;
    case 'tray:generate':
      forgeTrayStore.openForgeModal();
      // Or auto-submit if user confirmed
      break;
    // ...
  }
};
```

### Phase 3: Image Understanding

**Goal**: Assistant can see and describe images

**Multimodal Claude Request**:
```typescript
// When user asks to describe an image
const describeImage = async (variantId: string) => {
  const variant = variants.find(v => v.id === variantId);
  const imageUrl = getImageUrl(variant.image_key);

  // Fetch image and convert to base64
  const imageBase64 = await fetchImageAsBase64(imageUrl);

  // Send to Claude with vision
  const response = await claude.messages.create({
    model: 'claude-sonnet-4-20250514',
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', data: imageBase64 } },
        { type: 'text', text: 'Describe this image in detail for an artist.' }
      ]
    }]
  });
};
```

### Phase 4: Catalog Search

**Goal**: Natural language asset search with thumbnail results

**Search Flow**:
1. User: "Find assets with swords"
2. Claude parses intent → `{ action: 'search:assets', params: { query: 'sword' } }`
3. Backend searches assets by name, type, tags
4. Returns matching assets with thumbnails
5. Frontend renders as clickable cards in chat

**Search API Enhancement**:
```typescript
// New endpoint or extend chat response
interface SearchResult {
  assets: Array<{
    id: string;
    name: string;
    type: string;
    thumbnailUrl: string;
    matchReason: string; // "Name contains 'sword'"
  }>;
}
```

### Phase 5: Result Review Loop

**Goal**: Auto-describe generated images and suggest refinements

**Job Completion Hook**:
```typescript
// When generation completes
const handleJobComplete = async (jobId: string, variantId: string) => {
  // If assistant panel is open and was involved in generation
  if (assistantWasInvolved) {
    // Auto-send image to Claude for review
    const review = await reviewGeneratedImage(variantId, originalPrompt);

    // Display review in chat
    addAssistantMessage({
      type: 'review',
      content: review.description,
      suggestions: review.refinementSuggestions,
      variantId: variantId
    });
  }
};
```

---

## Data Flow Diagram

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   User      │     │  Assistant  │     │ Forge Tray  │
│   Input     │────▶│   Panel     │────▶│   Store     │
└─────────────┘     └─────────────┘     └─────────────┘
                          │                    │
                          ▼                    ▼
                    ┌─────────────┐     ┌─────────────┐
                    │   Claude    │     │  Generation │
                    │   API       │     │   Queue     │
                    └─────────────┘     └─────────────┘
                          │                    │
                          ▼                    ▼
                    ┌─────────────┐     ┌─────────────┐
                    │  Response   │     │   Result    │
                    │  + Actions  │◀────│  + Review   │
                    └─────────────┘     └─────────────┘
```

---

## Integration Points with Forge Tray Plan

### Required Store Exports from `forgeTrayStore.ts`

The Forge Tray store must expose these for assistant control:

```typescript
interface ForgeTrayStore {
  // State (readable by assistant)
  slots: ForgeSlot[];
  prompt: string;

  // Actions (callable by assistant)
  addSlot: (variant: Variant, asset: Asset) => boolean;
  removeSlot: (slotId: string) => void;
  clearSlots: () => void;
  setPrompt: (prompt: string) => void;  // NEW - not in original plan
  openForgeModal: (autoSubmit?: boolean) => void;  // Extended

  // Selectors (for context building)
  getOperation: () => ForgeOperation;
  getContext: () => ForgeContext;  // NEW - for assistant
}
```

### **Store Prerequisites**: COMPLETED ✅

The `forgeTrayStore.ts` already includes all required features:

```typescript
// Current implementation (src/frontend/stores/forgeTrayStore.ts)
interface ForgeTrayState {
  slots: ForgeSlot[];
  maxSlots: 14;
  prompt: string;  // ✅ Implemented

  // Actions
  addSlot: (variant: Variant, asset: Asset) => boolean;
  removeSlot: (slotId: string) => void;
  clearSlots: () => void;
  hasVariant: (variantId: string) => boolean;
  reorderSlots: (fromIndex: number, toIndex: number) => void;
  setPrompt: (prompt: string) => void;  // ✅ Implemented

  // For assistant integration
  getContext: () => ForgeContext;  // ✅ Implemented
}
```

The `getContext()` method returns:
```typescript
interface ForgeContext {
  operation: ForgeOperation;  // 'generate' | 'fork' | 'refine' | 'create' | 'combine'
  slots: Array<{ assetId: string; assetName: string; variantId: string }>;
  prompt: string;
}
```

---

## Phased Implementation

### Prerequisites: COMPLETED ✅
- [x] ForgeTray component implemented
- [x] forgeTrayStore with `prompt`, `setPrompt`, `getContext()`
- [x] 5 operation model (generate/fork/create/refine/combine)

### Phase 1: Context Awareness - COMPLETED ✅
- [x] Add `forgeContext` and `viewingContext` to chat API request
- [x] Extend Claude system prompt with tray state and viewing context
- [x] Display context bar in assistant panel (ChatSidebar)

### Phase 2: Tray Control - COMPLETED ✅
- [x] Implement tray action commands via Claude tool use
- [x] Execute tool calls (add_to_tray, remove_from_tray, clear_tray, set_prompt)
- [x] Connect to actual generation endpoints (generate_asset, refine_asset, combine_assets)

### Phase 3: Planning Capability - COMPLETED ✅
- [x] Add create_plan tool for multi-step operations
- [x] Plan UI with step-by-step display and status
- [x] Interactive step-by-step control: Start → Next Step → Done
- [x] Confirmation required between each step
- [x] Cancel at any point with progress summary
- [x] Visual progress tracking with animated indicators

### Phase 4: Catalog Search - COMPLETED ✅
- [x] Add search_assets tool
- [x] Basic name/type matching
- [ ] Render clickable asset cards in chat (future enhancement)

### Phase 5: Chat UI Redesign - COMPLETED ✅
- [x] Glassmorphic background matching ForgeTray aesthetic
- [x] Gradient header with branded title
- [x] Toggle-style mode selector (like ForgeTray destination toggle)
- [x] Unified input area with focus glow
- [x] Custom scrollbars, glossy send button
- [x] Enhanced message bubbles with shadows
- [x] Fixed page layout when chat is open
- [x] Mobile overlay mode (no content push)

**Note:** Enhanced existing `ChatSidebar` component rather than creating new `AssistantPanel` - pragmatic decision to avoid disruption.

### Phase 6: Image Understanding - COMPLETED ✅
- [x] Add multimodal Claude requests (describeImage, compareImages in ClaudeService)
- [x] Implement describe action (/api/spaces/:id/chat/describe endpoint)
- [x] Add image comparison capability (/api/spaces/:id/chat/compare endpoint)
- [x] Add describe_image and compare_variants tools for Claude

### Phase 7: Result Review Loop - COMPLETED ✅
- [x] Hook into job completion (onJobComplete callback in useSpaceWebSocket)
- [x] Track assistant-initiated jobs (assistantJobsRef in ChatSidebar)
- [x] Auto-review generated images when jobs complete
- [x] Display review with original prompt comparison

### Phase 8: Polish - COMPLETED ✅
- [x] Better error handling with categorized messages (network, rate limit, auth, etc.)
- [x] Retry capability for transient errors
- [x] Error message styling with retry button UI

**Deferred:**
- Streaming responses (requires SSE backend infrastructure)

---

## Files to Create/Modify

### New Files (Originally Planned - Not Created)
*Decision: Enhanced existing ChatSidebar instead of creating new component structure*

| File | Status |
|------|--------|
| `src/frontend/components/AssistantPanel/` | Not created - used ChatSidebar |
| `src/frontend/hooks/useAssistantActions.ts` | Not created - actions inline in ChatSidebar |

### Modified Files
| File | Changes |
|------|---------|
| `src/frontend/stores/forgeTrayStore.ts` | Add `prompt`, `setPrompt`, `getContext` |
| `src/backend/services/claudeService.ts` | Extend context, add new actions |
| `src/backend/routes/chat.ts` | Accept forgeContext in request |
| `src/frontend/pages/SpacePage.tsx` | Pass context props to ChatSidebar |

### Enhanced Files (Not Replaced)
| File | Status |
|------|--------|
| `src/frontend/components/ChatSidebar.tsx` | Enhanced with all assistant features |
| `src/frontend/components/ChatSidebar.module.css` | Enhanced with glassmorphic styling |

---

## Risk Assessment

### Low Risk
- Context sharing (just data passing)
- Prompt suggestions (Claude already does this)
- Catalog search (text matching)

### Medium Risk
- Tray control actions (state management complexity)
- Result review automation (timing issues)

### Higher Risk
- Image understanding (API costs, latency)
- Auto-generation triggers (user might not want auto-submit)

### Mitigations
- Always confirm before auto-generating
- Cache image descriptions
- Rate limit Claude vision calls
- Graceful fallbacks when Claude unavailable

---

## Success Criteria

1. User can ask assistant for prompt suggestions and apply them with one click
2. User can search catalog via natural language, see results as thumbnails
3. Assistant can add assets to tray when asked
4. Assistant can describe images when asked
5. Assistant automatically reviews generation results
6. All actions feel responsive (< 2s for text, < 5s for image analysis)
7. Clear visual feedback for all assistant actions

---

## Known Limitations

### Current Implementation
1. **No streaming responses** - Messages appear all at once after processing completes
2. **Text-only search results** - Asset search returns names, not clickable thumbnail cards
3. **Large image handling** - Very large images may fail base64 encoding (mitigated with chunked encoding)

### Future Enhancements
1. **Clickable asset cards** in search results with [+] buttons to add to tray
2. **SSE streaming** for real-time response display
3. **Semantic search** using embeddings for better asset discovery
4. **Voice input** for hands-free operation
