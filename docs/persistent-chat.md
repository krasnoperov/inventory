# Persistent Space Chat

Comprehensive documentation of the persistent chat feature implementation.

## Overview

The persistent chat system provides ForgeTray-aware conversations that persist across sessions. Each user has one active chat session per space, with messages stored in the SpaceDO SQLite database.

## Capabilities

| Feature | Description |
|---------|-------------|
| **Persistent History** | Messages survive page refresh and reconnection |
| **ForgeTray Context** | Each message includes current prompt + slot variant IDs |
| **Image Analysis** | Auto-describes images on first message with progress UI |
| **Suggested Prompts** | Claude can suggest prompts with "Apply" button |
| **Multi-turn Conversation** | Full conversation history sent to Claude |
| **Clear Chat** | Creates new session, old messages remain in DB |

## Architecture

### Database Schema (SpaceDO SQLite)

```sql
-- Chat sessions (one active per user)
CREATE TABLE chat_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Chat messages
CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id),
  sender_type TEXT NOT NULL,  -- 'user' | 'bot'
  sender_id TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata TEXT,              -- JSON: forgeContext, suggestedPrompt, descriptions
  created_at INTEGER NOT NULL
);

-- User session tracking
CREATE TABLE user_sessions (
  user_id TEXT PRIMARY KEY,
  active_chat_session_id TEXT REFERENCES chat_sessions(id),
  -- ... other session fields
);
```

### Message Metadata

**User Message Metadata:**
```typescript
interface UserMessageMetadata {
  forgeContext?: {
    prompt: string;
    slotVariantIds: string[];
  };
}
```

**Bot Message Metadata:**
```typescript
interface BotMessageMetadata {
  suggestedPrompt?: string;
  descriptions?: Array<{
    variantId: string;
    assetName: string;
    description: string;
    cached: boolean;
  }>;
  usage?: { inputTokens: number; outputTokens: number };
}
```

## Message Types

### Client → Server

| Message | Purpose |
|---------|---------|
| `chat:history` | Request message history for active session |
| `chat:send` | Send user message with optional forge context |
| `chat:clear` | Create new session, clear UI |

### Server → Client

| Message | Purpose |
|---------|---------|
| `chat:history` | Return messages array + sessionId |
| `chat:message` | Single message (user confirmation OR bot response) |
| `chat:progress` | Image description progress during first message |

## Feature Flows

### 1. Load History

**Trigger:** ForgeChat panel opens (user clicks chat button)

```
Frontend                              Backend (ChatController)
   |                                        |
   |-- chat:history ----------------------->|
   |                                        | Get user's active_chat_session_id
   |                                        | Load last 50 messages from session
   |<-- chat:history -----------------------|
   |    {sessionId, messages[]}             |
   |                                        |
   | setChatMessages(messages)              |
```

**UI Behavior:**
- Chat panel shows loading spinner briefly
- Messages populate in chronological order
- Bot messages with `suggestedPrompt` show "Apply" button

**Persistence:** Read-only - no writes

**Broadcast:** None - sent only to requesting client

---

### 2. Send Message

**Trigger:** User types message and presses Enter/Send

```
Frontend                              Backend (ChatController)
   |                                        |
   | Optimistic: add temp user message      |
   | setIsChatLoading(true)                 |
   |                                        |
   |-- chat:send -------------------------->|
   |    {content, forgeContext?}            |
   |                                        | Get/create active session
   |                                        | Store user message in DB
   |<-- chat:message -----------------------|
   |    {message: userMsg}                  |
   |                                        |
   | Replace temp with real user msg        |
   |                                        |
   |                                        | [If first msg + has images]
   |                                        | For each slot variant:
   |<-- chat:progress ----------------------|  (see Image Analysis below)
   |                                        |
   |                                        | Call Claude with context + history
   |                                        | Store bot message in DB
   |<-- chat:message -----------------------|
   |    {message: botMsg}                   |
   |                                        |
   | Append bot message                     |
   | setIsChatLoading(false)                |
```

**UI Behavior:**
1. User message appears immediately (optimistic, temp ID)
2. Temp message replaced with server-confirmed message (real ID)
3. Loading indicator shows while waiting for bot
4. Bot message appears with typing effect (if implemented)
5. If `suggestedPrompt` present, "Apply" button shown

**Persistence:**
- User message stored immediately after validation
- Bot message stored after Claude response
- Both in `chat_messages` table with session reference

**Broadcast:** None - sent only to requesting client

---

### 3. Clear Chat

**Trigger:** User clicks "Clear" button in chat header

```
Frontend                              Backend (ChatController)
   |                                        |
   |-- chat:clear ------------------------->|
   |                                        | Create new chat_session
   |                                        | Update user's active_chat_session_id
   |<-- chat:history -----------------------|
   |    {sessionId: newId, messages: []}    |
   |                                        |
   | setChatMessages([])                    |
```

**UI Behavior:**
- Chat panel clears immediately
- Ready for new conversation

**Persistence:**
- New `chat_sessions` row created
- `user_sessions.active_chat_session_id` updated
- Old session and messages remain in DB (not deleted)

**Broadcast:** None - sent only to requesting client

---

### 4. Image Analysis (First Message)

**Trigger:** First message in session when ForgeTray has slots with images

```
Frontend                              Backend (ChatController)
   |                                        |
   |                                        | For each slotVariantId:
   |                                        |   Check variants.description
   |                                        |
   |                                        |   If cached:
   |<-- chat:progress ----------------------|
   |    {phase:'describing', status:'cached',|
   |     variantId, assetName, description, |
   |     index, total}                      |
   |                                        |
   |                                        |   If not cached:
   |<-- chat:progress ----------------------|
   |    {phase:'describing', status:'started',
   |     variantId, assetName, index, total}|
   |                                        |
   |                                        |   Fetch image from R2
   |                                        |   Call Claude vision API
   |                                        |   Cache in variants.description
   |                                        |
   |<-- chat:progress ----------------------|
   |    {phase:'describing', status:'completed',
   |     variantId, assetName, description, |
   |     index, total}                      |
   |                                        |
   | Show progress: "Analyzing 1/3..."      |
```

**UI Behavior:**
- Progress indicator: "Analyzing image 1 of 3..."
- Each image shows status: cached (instant) or generating
- Descriptions shown as they complete

**Persistence:**
- Generated descriptions cached in `variants.description` column
- Descriptions also stored in bot message metadata
- Subsequent messages use cached descriptions (no progress)

**Broadcast:**
- `variant:updated` broadcast to ALL clients when description cached
- Progress messages only to requesting client

---

### 5. Suggested Prompts

**Trigger:** Claude's response includes a `<suggested_prompt>` tag

```
Frontend                              Backend (ChatController)
   |                                        |
   |                                        | Claude response parsed
   |                                        | suggestedPrompt extracted
   |                                        | Stored in message metadata
   |<-- chat:message -----------------------|
   |    {message: {                         |
   |      content: "...",                   |
   |      suggestedPrompt: "A dragon..."    |
   |    }}                                  |
   |                                        |
   | Render "Apply" button next to prompt   |
```

**UI Behavior:**
- Bot message shows normally
- If `suggestedPrompt` exists, render with "Apply" button
- Click "Apply" → copies prompt to ForgeTray prompt input

**Persistence:** Stored in `chat_messages.metadata` JSON

**Broadcast:** None - sent only to requesting client

---

### 6. Multi-turn Conversation

**Implementation:** On each `chat:send`, backend loads last 50 messages from session and passes to Claude.

```typescript
// ChatController.handleChatSend()
const history = await this.repo.getChatHistoryBySession(sessionId, 50);
const conversationHistory = history
  .filter(m => m.id !== userMessage.id)  // Exclude just-added message
  .map(m => ({
    role: m.sender_type === 'user' ? 'user' : 'assistant',
    content: m.content,
  }));

const result = await claudeService.forgeChat(
  content,           // Current message
  currentPrompt,     // ForgeTray prompt
  variantDescriptions,
  conversationHistory,  // Full history
  images
);
```

**UI Behavior:** User sees continuous conversation with context

**Persistence:** Each message stored individually, history reconstructed on send

**Broadcast:** None

## Code Locations

| Component | File | Key Methods |
|-----------|------|-------------|
| **ChatController** | `src/backend/durable-objects/space/controllers/ChatController.ts` | `handleChatHistory`, `handleChatSend`, `handleChatClear` |
| **SpaceDO routing** | `src/backend/durable-objects/SpaceDO.ts:321-326` | Routes `chat:*` to ChatController |
| **WebSocket hook** | `src/frontend/hooks/useSpaceWebSocket.ts` | `sendPersistentChatMessage`, `requestChatHistory`, `clearChatSession` |
| **ForgeChat UI** | `src/frontend/components/ForgeTray/ForgeChat.tsx` | Chat panel component |
| **SpacePage** | `src/frontend/pages/SpacePage.tsx:62-85` | Chat state management |
| **AssetDetailPage** | `src/frontend/pages/AssetDetailPage.tsx:77-101` | Chat state management |
| **ClaudeService** | `src/backend/services/claudeService.ts` | `forgeChat()` method |

## Key Design Decisions

1. **One active session per user** - Simplifies UX, no session picker needed
2. **Context sent fresh each message** - Not stored in session, always current
3. **Lazy history loading** - Only fetch when panel opens
4. **Optimistic UI** - User message appears immediately, replaced on confirmation
5. **No multi-user broadcast** - Chat is personal to each user
6. **Old sessions preserved** - Clear creates new session, doesn't delete old
7. **50 message limit** - Prevents context overflow, balances cost/utility

## Error Handling

| Error | Response |
|-------|----------|
| Empty message | `VALIDATION_ERROR` - blocked client-side |
| No Claude API key | `INTERNAL_ERROR` - "Claude API not configured" |
| Session not found | Auto-creates new session |
| Image fetch failed | Skipped, continues with other images |
| Claude API error | `INTERNAL_ERROR` - logged, generic message to user |

## Future Considerations

- **Multi-user broadcast**: Currently chat is private; could broadcast for collaborative mode
- **Session history UI**: Allow browsing/restoring old sessions
- **Message editing**: Allow editing user messages (creates new thread?)
- **Streaming responses**: Stream Claude's response for better UX
