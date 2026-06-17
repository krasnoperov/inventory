import { useState, useEffect } from 'react';

/** A voice from the connected ElevenLabs account (mirrors backend ElevenLabsVoiceSummary). */
export interface Voice {
  voiceId: string;
  name: string;
  category: string | null;
  description: string | null;
  previewUrl: string | null;
  labels: Record<string, string>;
}

interface VoicesResponse {
  available: boolean;
  voices: Voice[];
}

interface UseVoicesResult {
  /** Whether ElevenLabs is the active provider and voices can be selected */
  available: boolean;
  voices: Voice[];
  isLoading: boolean;
  error: string | null;
}

// Voices belong to the account, not a space, and change rarely — cache the
// in-flight/resolved fetch at module scope so every ForgeTray shares one load.
let voicesCache: Promise<VoicesResponse> | null = null;

function loadVoices(): Promise<VoicesResponse> {
  if (!voicesCache) {
    voicesCache = fetch('/api/voices', { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Failed to load voices');
        }
        return (await response.json()) as VoicesResponse;
      })
      .catch((err) => {
        // Don't poison the cache on failure — allow a later retry.
        voicesCache = null;
        throw err;
      });
  }
  return voicesCache;
}

/**
 * Loads the ElevenLabs voice library for the UI voice picker.
 * Returns `available: false` when ElevenLabs isn't the active audio provider.
 */
export function useVoices(): UseVoicesResult {
  const [state, setState] = useState<UseVoicesResult>({
    available: false,
    voices: [],
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    loadVoices()
      .then((data) => {
        if (cancelled) return;
        setState({ available: data.available, voices: data.voices, isLoading: false, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          available: false,
          voices: [],
          isLoading: false,
          error: err instanceof Error ? err.message : 'Failed to load voices',
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
