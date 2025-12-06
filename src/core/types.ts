// ============================================================================
// BARE FRAMEWORK FOUNDATION - Environment Types
// ============================================================================
// Define your Cloudflare Workers bindings here

import type { GenerationWorkflowInput } from '../backend/workflows/types';

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

  // AI services (for NanoBananaService and future use)
  GOOGLE_AI_API_KEY?: string;
  AI?: Ai;
  AI_GATEWAY_URL?: string;

  // Optional: OpenAI for future use
  OPENAI_API_KEY?: string;

  // Environment
  ENVIRONMENT?: 'local' | 'development' | 'stage' | 'staging' | 'production';

  // R2 Storage for generated images (required for Inventory Forge)
  IMAGES: R2Bucket;

  // Inventory Forge: Space Durable Objects
  SPACES_DO?: DurableObjectNamespace;

  // Inventory Forge: Cloudflare Workflows
  GENERATION_WORKFLOW?: WorkflowBinding<GenerationWorkflowInput>;

  // Inventory Forge: Rate limiting for bots
  RATE_LIMIT_KV?: KVNamespace;

  // Inventory Forge: Claude API for generation
  ANTHROPIC_API_KEY?: string;

  // Polar.sh billing integration
  POLAR_ACCESS_TOKEN?: string;
  POLAR_ORGANIZATION_ID?: string;
  POLAR_WEBHOOK_SECRET?: string;
  POLAR_ENVIRONMENT?: 'sandbox' | 'production';

  // Internal API authentication (for cron jobs, internal services)
  INTERNAL_API_SECRET?: string;

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
