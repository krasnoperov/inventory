import { useCallback } from 'react';
import { useVoices, type Voice } from '../../hooks/useVoices';
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

function voiceOptions(voices: Voice[]) {
  return voices.map((voice) => (
    <option key={voice.voiceId} value={voice.voiceId}>
      {voice.name}
    </option>
  ));
}

/**
 * Voice selector for ElevenLabs audio generation, shown in speech/dialogue
 * Forge modes. Renders nothing when ElevenLabs isn't the active provider so
 * generation falls back to env-configured voices.
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

  const handleDialogueChange = useCallback(
    (index: number, value: string) => {
      const next = [...dialogueVoiceIds];
      next[index] = value;
      onDialogueVoiceIdsChange(next);
    },
    [dialogueVoiceIds, onDialogueVoiceIdsChange]
  );

  const handleAddSpeaker = useCallback(() => {
    onDialogueVoiceIdsChange([...dialogueVoiceIds, voices[0]?.voiceId ?? '']);
  }, [dialogueVoiceIds, onDialogueVoiceIdsChange, voices]);

  const handleRemoveSpeaker = useCallback(
    (index: number) => {
      onDialogueVoiceIdsChange(dialogueVoiceIds.filter((_, i) => i !== index));
    },
    [dialogueVoiceIds, onDialogueVoiceIdsChange]
  );

  // Hide entirely when voices can't be selected — env defaults still apply.
  if (isLoading || !available || voices.length === 0) {
    return null;
  }

  if (mode === 'speech') {
    return (
      <div className={styles.voicePicker} title="Voice for speech generation">
        <span className={styles.label}>Voice</span>
        <select
          className={styles.select}
          value={voiceId ?? ''}
          onChange={(e) => onVoiceIdChange(e.target.value || undefined)}
          disabled={disabled}
        >
          <option value="">Default</option>
          {voiceOptions(voices)}
        </select>
      </div>
    );
  }

  // Dialogue: ordered list of voices assigned to speakers in prompt order.
  const rows = dialogueVoiceIds.length > 0 ? dialogueVoiceIds : [''];
  return (
    <div className={styles.voicePicker} title="Voices assigned to speakers in order">
      <span className={styles.label}>Voices</span>
      {rows.map((id, index) => (
        <div key={index} className={styles.dialogueRow}>
          <span className={styles.speakerIndex}>{index + 1}.</span>
          <select
            className={styles.select}
            value={id}
            onChange={(e) => handleDialogueChange(index, e.target.value)}
            disabled={disabled}
          >
            <option value="">Default</option>
            {voiceOptions(voices)}
          </select>
          {rows.length > 1 && (
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => handleRemoveSpeaker(index)}
              disabled={disabled}
              title="Remove voice"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                <path d="M5 12h14" />
              </svg>
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        className={styles.iconButton}
        onClick={handleAddSpeaker}
        disabled={disabled}
        title="Add speaker voice"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </div>
  );
}

export default VoicePicker;
