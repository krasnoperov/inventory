/**
 * AudioPlayer - Compact, design-token-styled audio player.
 *
 * Replaces the raw browser `<audio controls>` widget, which renders native
 * chrome that ignores the design system and collapses awkwardly inside small
 * cards. Wraps a hidden `<audio>` element and drives a custom play/pause
 * button, a seekable scrubber, and a current/total time readout.
 *
 * Pointer/click events are stopped at the container so the player stays usable
 * inside draggable or clickable surfaces (e.g. canvas nodes, asset tiles).
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { formatPlaybackTime } from '../../lib/format';
import styles from './AudioPlayer.module.css';

export interface AudioPlayerProps {
  /** Audio media URL */
  src: string;
  /** Additional CSS class */
  className?: string;
}

function AudioPlayerComponent({ src, className }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Sync local state with the underlying media element's events.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTime = () => setCurrentTime(audio.currentTime);
    const onMeta = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('durationchange', onMeta);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onPause);

    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('durationchange', onMeta);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onPause);
    };
  }, []);

  // Reset transport state when the source changes.
  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [src]);

  const stopEvent = useCallback((e: React.SyntheticEvent) => e.stopPropagation(), []);

  const togglePlay = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play();
    } else {
      audio.pause();
    }
  }, []);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const next = Number(e.target.value);
    audio.currentTime = next;
    setCurrentTime(next);
  }, []);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const classes = [styles.player, className].filter(Boolean).join(' ');

  return (
    <div className={classes} onPointerDown={stopEvent} onClick={stopEvent}>
      <audio ref={audioRef} src={src} preload="metadata" />
      <button
        type="button"
        className={styles.playButton}
        onClick={togglePlay}
        aria-label={isPlaying ? 'Pause' : 'Play'}
        aria-pressed={isPlaying}
      >
        {isPlaying ? (
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M8 5.14v13.72a1 1 0 0 0 1.52.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14z" />
          </svg>
        )}
      </button>

      <input
        type="range"
        className={styles.scrubber}
        min={0}
        max={duration || 0}
        step="any"
        value={currentTime}
        onChange={handleSeek}
        onPointerDown={stopEvent}
        disabled={!duration}
        aria-label="Seek"
        style={{ '--progress': `${progress}%` } as React.CSSProperties}
      />

      <span className={styles.time}>
        {formatPlaybackTime(currentTime)}
        {duration > 0 && <span className={styles.duration}> / {formatPlaybackTime(duration)}</span>}
      </span>
    </div>
  );
}

export const AudioPlayer = memo(AudioPlayerComponent);
export default AudioPlayer;
