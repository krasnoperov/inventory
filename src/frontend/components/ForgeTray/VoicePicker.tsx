import { useCallback, useEffect } from 'react';
import { useVoices, type Voice } from '../../hooks/useVoices';
import { IconButton, UiSelect, type SelectOption } from '../../ui';
import styles from './VoicePicker.module.css';

export interface VoicePickerProps {
  /** 'speech' uses a single voice; 'dialogue' uses an ordered list mapped to speakers */
  mode: 'speech' | 'dialogue';
  disabled?: boolean;
  /** Selected speech voice ID (speech mode) */
  voiceId?: string;
  onVoiceIdChange: (voiceId: string | undefined) => void;
  /** Ordered dialogue voice IDs (dialogue mode) */
  dialogueVoiceIds: string[];
  onDialogueVoiceIdsChange: (voiceIds: string[]) => void;
}

/** Label a voice with a short descriptor so the list is scannable, not just a name. */
function voiceLabel(voice: Voice): string {
  const hints = [voice.labels.gender, voice.labels.accent, voice.labels.use_case, voice.category]
    .map((hint) => hint?.trim())
    .filter((hint): hint is string => Boolean(hint));
  return hints.length > 0 ? `${voice.name} — ${hints.join(', ')}` : voice.name;
}

function voiceOptions(voices: Voice[]): Array<SelectOption<string>> {
  return voices.map((voice) => ({
    value: voice.voiceId,
    label: voiceLabel(voice),
    textValue: voice.name,
  }));
}

/**
 * Voice selector for ElevenLabs audio generation, shown in speech/dialogue
 * Forge modes. The voice is always chosen here — there is no env-configured
 * default — so a real voice is pre-selected as soon as the library loads.
 * Renders nothing when ElevenLabs isn't the active provider (e.g. the local
 * fake provider, which needs no voice).
 */
export function VoicePicker({
  mode,
  disabled = false,
  voiceId,
  onVoiceIdChange,
  dialogueVoiceIds,
  onDialogueVoiceIdsChange,
}: VoicePickerProps) {
  const { available, voices, isLoading } = useVoices();
  const firstVoiceId = voices[0]?.voiceId;

  // No default voice exists, so seed a real selection once the library loads.
  // The user can change it; this just guarantees generation never runs voiceless.
  useEffect(() => {
    if (!available || !firstVoiceId) return;
    if (mode === 'speech') {
      if (!voiceId) onVoiceIdChange(firstVoiceId);
    } else if (dialogueVoiceIds.length === 0) {
      onDialogueVoiceIdsChange([firstVoiceId]);
    }
  }, [
    available,
    firstVoiceId,
    mode,
    voiceId,
    dialogueVoiceIds.length,
    onVoiceIdChange,
    onDialogueVoiceIdsChange,
  ]);

  const handleDialogueChange = useCallback(
    (index: number, value: string) => {
      const next = [...dialogueVoiceIds];
      next[index] = value;
      onDialogueVoiceIdsChange(next);
    },
    [dialogueVoiceIds, onDialogueVoiceIdsChange]
  );

  const handleAddSpeaker = useCallback(() => {
    onDialogueVoiceIdsChange([...dialogueVoiceIds, firstVoiceId ?? '']);
  }, [dialogueVoiceIds, onDialogueVoiceIdsChange, firstVoiceId]);

  const handleRemoveSpeaker = useCallback(
    (index: number) => {
      onDialogueVoiceIdsChange(dialogueVoiceIds.filter((_, i) => i !== index));
    },
    [dialogueVoiceIds, onDialogueVoiceIdsChange]
  );

  // Hide entirely when voices can't be selected (provider isn't ElevenLabs, or
  // the library hasn't loaded). The fake provider needs no voice.
  if (isLoading || !available || voices.length === 0) {
    return null;
  }

  if (mode === 'speech') {
    return (
      <div className={styles.voicePicker} title="Voice for speech generation">
        <UiSelect
          className={styles.voiceSelect}
          value={voiceId ?? firstVoiceId ?? ''}
          options={voiceOptions(voices)}
          onValueChange={onVoiceIdChange}
          disabled={disabled}
          label="Speech voice"
        />
      </div>
    );
  }

  // Dialogue: ordered list of voices assigned to speakers in prompt order.
  const rows = dialogueVoiceIds.length > 0 ? dialogueVoiceIds : [firstVoiceId ?? ''];
  return (
    <div className={styles.voicePicker} title="Voices assigned to speakers in order">
      {rows.map((id, index) => (
        <div key={index} className={styles.dialogueRow}>
          <span className={styles.speakerIndex}>{index + 1}.</span>
          <UiSelect
            className={styles.voiceSelect}
            value={id || firstVoiceId || ''}
            options={voiceOptions(voices)}
            onValueChange={(nextValue) => handleDialogueChange(index, nextValue)}
            disabled={disabled}
            label={`Speaker ${index + 1} voice`}
          />
          {rows.length > 1 && (
            <IconButton
              className={styles.iconButton}
              onClick={() => handleRemoveSpeaker(index)}
              disabled={disabled}
              title="Remove voice"
              aria-label="Remove voice"
              variant="ghost"
              size="sm"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                <path d="M5 12h14" />
              </svg>
            </IconButton>
          )}
        </div>
      ))}
      <IconButton
        className={styles.iconButton}
        onClick={handleAddSpeaker}
        disabled={disabled}
        title="Add speaker voice"
        aria-label="Add speaker voice"
        variant="ghost"
        size="sm"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </IconButton>
    </div>
  );
}

export default VoicePicker;
