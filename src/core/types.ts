// ============================================================================
// BARE FRAMEWORK FOUNDATION - Environment Types
// ============================================================================
// Define your Cloudflare Workers bindings here

import type { GenerationWorkflowInput } from '../backend/workflows/types';
import type { KeyBrokerServiceBinding } from '../backend/key-broker/client';

export interface SendEmailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
}

export interface SendEmailBinding {
  send(message: SendEmailMessage): Promise<unknown>;
}

/** Cloudflare Workflow instance handle */
export interface WorkflowInstance {
  id: string;
  pause(): Promise<void>;
  resume(): Promise<void>;
  terminate(): Promise<void>;
  restart(): Promise<void>;
  status(): Promise<{
    status: 'queued' | 'running' | 'paused' | 'complete' | 'errored' | 'terminated' | 'unknown';
    error?: string;
    output?: unknown;
  }>;
}

/** Cloudflare Workflow binding */
export interface WorkflowBinding<TInput> {
  create(options: { id?: string; params: TInput }): Promise<WorkflowInstance>;
  get(id: string): Promise<WorkflowInstance>;
}

export interface Env {
  // D1 Database
  DB: D1Database;

  // KV Storage
  OAUTH_KV: KVNamespace;

  // Static assets (served via Cloudflare Workers Assets)
  ASSETS: Fetcher;

  // Cloudflare Email Service binding for transactional notifications.
  EMAIL?: SendEmailBinding;

  // Authentication environment variables
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REDIRECT_URI?: string;
  OIDC_PRIVATE_KEY_BASE64: string;
  OIDC_PRIVATE_KEY?: string; // Alternative to _BASE64
  OIDC_PUBLIC_KEY?: string;  // Public key for JWT verification
  OIDC_KEY_ID: string;
  OIDC_ISSUER: string;
  OIDC_AUDIENCE: string;
  OIDC_ALLOWED_CLIENT_IDS?: string;
  PUBLIC_SITE_ORIGIN?: string;

  // AI services (for NanoBananaService and future use)
  GOOGLE_AI_API_KEY?: string;
  INVENTORY_IMAGE_PROVIDER?: 'fake' | 'gemini';
  // Optional override; audio provider otherwise resolves from ENVIRONMENT
  // (ElevenLabs in production, fake elsewhere). See resolveAudioProvider().
  INVENTORY_AUDIO_PROVIDER?: 'fake' | 'elevenlabs';
  ELEVENLABS_API_KEY?: string;
  // No default voice: voices are chosen per generation in the UI/CLI.
  ELEVENLABS_MODEL_ID?: string;
  ELEVENLABS_AUDIO_OUTPUT_FORMAT?: string;
  ELEVENLABS_MUSIC_MODEL_ID?: string;
  ELEVENLABS_SOUND_EFFECT_MODEL_ID?: string;
  ELEVENLABS_MUSIC_OUTPUT_FORMAT?: string;
  ELEVENLABS_SOUND_EFFECT_OUTPUT_FORMAT?: string;
  LYRIA_PROJECT_ID?: string;
  LYRIA_LOCATION?: string;
  LYRIA_MODEL_ID?: string;
  LYRIA_ACCESS_TOKEN?: string;
  LYRIA_API_KEY?: string;
  LYRIA_BASE_URL?: string;
  AI?: Ai;
  AI_GATEWAY_URL?: string;

  // Optional: OpenAI for future use
  OPENAI_API_KEY?: string;

  // Custom model endpoint for fine-tuned models (Phase 6)
  CUSTOM_MODEL_ENDPOINT?: string;
  CUSTOM_MODEL_API_KEY?: string;

  // Environment
  ENVIRONMENT?: 'local' | 'development' | 'stage' | 'staging' | 'production';
  MAKEFX_MEDIA_CDN_BASE_URL?: string;
  MAKEFX_EMAIL_FROM?: string;
  MAKEFX_ADMIN_NOTIFICATION_EMAILS?: string;
  INVENTORY_DEV_AUTH_TOKEN?: string;
  INVENTORY_DEV_USER_ID?: string;
  ENCRYPTION_KEY?: string;
  BYOK_ACTIVE_KEK_VERSION?: string;
  BYOK_KEK_V1?: string | SecretsStoreSecret;
  BYOK_KEK_V2?: string | SecretsStoreSecret;
  [binding: `BYOK_KEK_V${number}`]: string | SecretsStoreSecret | undefined;

  // R2 Storage for generated images (required for Make Effects)
  IMAGES: R2Bucket;

  // Make Effects: Space Durable Objects
  SPACES_DO?: DurableObjectNamespace;

  // Make Effects: Cloudflare Workflows
  GENERATION_WORKFLOW?: WorkflowBinding<GenerationWorkflowInput>;

  // Make Effects: BYOK key custody boundary. Later app/generation changes should
  // call this service binding instead of reading BYOK KEK material directly.
  KEY_BROKER?: KeyBrokerServiceBinding;

  // Make Effects: Rate limiting for bots
  RATE_LIMIT_KV?: KVNamespace;

  // Make Effects: Claude API for generation
  ANTHROPIC_API_KEY?: string;

  // Polar.sh billing integration
  POLAR_ACCESS_TOKEN?: string;
  POLAR_ORGANIZATION_ID?: string;
  POLAR_PAID_GENERATION_PRODUCT_ID?: string;
  POLAR_WEBHOOK_SECRET?: string;
  POLAR_ENVIRONMENT?: 'sandbox' | 'production';

  // Internal API authentication (for cron jobs, internal services)
  INTERNAL_API_SECRET?: string;

  // Admin user IDs (comma-separated) for billing admin routes
  ADMIN_USER_IDS?: string;

  // --- FUTURE: Add your domain-specific bindings here ---
  // Example for queues:
  // MY_QUEUE?: Queue<any>;
  //
  // Example for workflows:
  // MY_WORKFLOW?: {
  //   create(options: { id?: string; params: MyWorkflowInput }): Promise<{
  //     id: string;
  //     status(): Promise<any>;
  //   }>;
  //   get(id: string): Promise<{
  //     id: string;
  //     status(): Promise<any>;
  //   }>;
  // };
}
