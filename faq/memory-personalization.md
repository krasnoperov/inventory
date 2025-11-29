# Memory & Personalization

## What is Memory & Personalization?

The Forge Assistant learns from your successful prompts and preferences to provide better suggestions over time. This feature helps the AI understand your creative style and makes increasingly relevant recommendations.

## How it works

### Pattern Learning

When you generate assets that you like, the system captures the prompts that worked well. These "patterns" are then:

1. **Stored securely** in your user profile
2. **Injected into the AI context** when you chat with the assistant
3. **Used to suggest** similar prompts for new generations

For example, if you often generate "pixel art characters with vibrant colors", the assistant will learn this preference and suggest similar styles for future character creations.

### What Gets Learned

- **Prompts** - The exact text you used for successful generations
- **Asset types** - What kind of assets you create (character, scene, object, etc.)
- **Usage patterns** - How often you use similar prompts
- **Feedback** - Which variants you liked (thumbs up) or disliked (thumbs down)

## The Preferences Panel

Access the Preferences Panel by clicking the **gear icon (⚙)** in the chat sidebar header.

### Learned Patterns Section

Shows all the prompts the assistant has learned from you:

- **Asset type** - [character], [scene], [object], etc.
- **Prompt preview** - First 60 characters of the prompt
- **Usage stats** - How many times this pattern was used
- **Last used** - When you last used this pattern
- **Forget button** - Remove this pattern from memory

### Style Preferences

Set your default preferences:

- **Default Art Style** - Choose from: Pixel Art, Fantasy Realism, Anime, Cartoon, Painterly, Photorealistic
- **Default Aspect Ratio** - Choose from: 1:1 (Square), 16:9 (Widescreen), 9:16 (Portrait), 4:3, 3:4

These defaults are suggested when generating new assets.

### Trust Settings

Configure how the assistant behaves:

- **Auto-execute safe operations** - Run search/describe automatically (see Trust Zones)
- **Auto-approve low-cost generations** - Skip approval for quick refinements (coming soon)
- **Use learned patterns in suggestions** - Include your patterns in AI context
- **Max patterns in context** - How many patterns to include (0-10)

## Feedback System

Help the assistant learn by providing feedback:

- **Thumbs up (👍)** - Marks a variant as successful, captures the prompt as a pattern
- **Thumbs down (👎)** - Marks a variant as unsuccessful, helps avoid similar results

### How to give feedback

Currently, feedback can be given through the API endpoint. A UI for giving feedback is planned for a future release.

## Privacy & Data

### What's stored

- Patterns are stored in the D1 database (`user_patterns` table)
- Feedback is stored in the D1 database (`user_feedback` table)
- Preferences are stored in the D1 database (`user_preferences` table)

### Data ownership

- All memory data is tied to your user account
- You can delete individual patterns via the "Forget" button
- All data is deleted when your account is deleted

### Disabling personalization

If you prefer the assistant not to learn from your usage:

1. Open the Preferences Panel
2. Uncheck "Use learned patterns in suggestions"
3. Optionally, delete existing patterns with "Forget"

## API Endpoints

For developers integrating with the memory system:

```
GET    /api/users/me/patterns        - List learned patterns
DELETE /api/users/me/patterns/:id    - Delete a pattern
GET    /api/users/me/preferences     - Get user preferences
PUT    /api/users/me/preferences     - Update preferences
POST   /api/spaces/:id/chat/feedback - Submit variant feedback
GET    /api/users/me/feedback/stats  - Get feedback statistics
```

## Technical Details

### Backend Components

- **MemoryDAO** (`src/dao/memory-dao.ts`) - Data access for patterns, feedback, preferences
- **MemoryService** (`src/backend/services/memoryService.ts`) - Business logic for pattern capture and context building
- **Database schema** (`db/migrations/0006_assistant_memory.sql`) - Tables for patterns, feedback, preferences

### Frontend Components

- **PreferencesPanel** (`src/frontend/components/ChatSidebar/PreferencesPanel.tsx`) - UI for managing preferences and patterns

### How patterns are injected

1. When you send a chat message, the backend calls `memoryService.getPersonalizationContext()`
2. This fetches your top patterns (limited by `max_patterns_context`)
3. The patterns are formatted and added to Claude's system prompt
4. Claude sees something like:

```
USER'S SUCCESSFUL PATTERNS:
- "A brave knight in silver armor, pixel art style" [character] (used 5x)
- "Fantasy forest with magical lighting, detailed" [scene] (used 3x)
Consider these patterns when suggesting prompts or generating assets.
```

5. Claude uses this context to make better suggestions aligned with your style
