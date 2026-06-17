import { Hono } from 'hono';
import type { AppContext } from './types';
import { authMiddleware } from '../middleware/auth-middleware';
import { listElevenLabsVoices, ElevenLabsApiError } from '../services/elevenLabsAudioProvider';
import { loggers } from '../../shared/logger';

const log = loggers.generationController;

const voicesRoutes = new Hono<AppContext>();

// Voice listing requires authentication
voicesRoutes.use('/api/voices', authMiddleware);

/**
 * GET /api/voices - List voices available for ElevenLabs audio generation.
 *
 * Proxies the connected ElevenLabs account's voice library so the UI can offer
 * a picker instead of relying on env-configured voice IDs. Returns
 * `{ available: false, voices: [] }` when ElevenLabs is not the active provider
 * or no API key is configured, so the frontend can hide the picker gracefully.
 */
voicesRoutes.get('/api/voices', async (c) => {
  const env = c.env;

  if (env.INVENTORY_AUDIO_PROVIDER !== 'elevenlabs' || !env.ELEVENLABS_API_KEY) {
    return c.json({ available: false, voices: [] });
  }

  try {
    const voices = await listElevenLabsVoices(env.ELEVENLABS_API_KEY);
    // Voices change rarely; let clients/CDN cache briefly to avoid hammering ElevenLabs.
    c.header('Cache-Control', 'private, max-age=300');
    return c.json({ available: true, voices });
  } catch (err) {
    const status = err instanceof ElevenLabsApiError ? err.status : 502;
    log.warn('Failed to list ElevenLabs voices', {
      status,
      error: err instanceof Error ? err.message : String(err),
    });
    return c.json({ available: true, voices: [], error: 'Failed to load voices' }, 502);
  }
});

export { voicesRoutes };
