import { useState, useEffect } from 'react';
import styles from './ChatSidebar.module.css';

/**
 * Countdown timer for rate limit errors (HTTP 429)
 *
 * Shows a countdown timer until the rate limit window resets,
 * with a progress bar visualization.
 *
 * @see LimitErrorResponse in api/types.ts for error response structure
 * @see PreCheckResult in usageService.ts for rate limit implementation
 * @see faq/error-handling.md for user documentation
 */
interface RateLimitCountdownProps {
  /** ISO date string when the rate limit resets */
  resetsAt: string | null;
  /** Initial seconds remaining (fallback if resetsAt not available) */
  initialSeconds: number;
  /** Called when countdown reaches zero */
  onExpired?: () => void;
}

export function RateLimitCountdown({
  resetsAt,
  initialSeconds,
  onExpired,
}: RateLimitCountdownProps) {
  // Calculate initial seconds from resetsAt or use fallback
  const calculateSecondsLeft = () => {
    if (resetsAt) {
      return Math.max(0, Math.ceil((new Date(resetsAt).getTime() - Date.now()) / 1000));
    }
    return initialSeconds;
  };

  const [secondsLeft, setSecondsLeft] = useState(calculateSecondsLeft);
  const [totalSeconds] = useState(calculateSecondsLeft);

  useEffect(() => {
    if (secondsLeft <= 0) {
      onExpired?.();
      return;
    }

    const timer = setInterval(() => {
      setSecondsLeft((prev) => {
        const newVal = prev - 1;
        if (newVal <= 0) {
          onExpired?.();
          return 0;
        }
        return newVal;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [secondsLeft, onExpired]);

  // Ready state - countdown complete
  if (secondsLeft <= 0) {
    return <span className={styles.countdownReady}>Ready to try again</span>;
  }

  // Progress as percentage (100% at start, 0% at end)
  const progressPercent = totalSeconds > 0 ? (secondsLeft / totalSeconds) * 100 : 0;

  return (
    <div className={styles.rateLimitCountdown}>
      <div className={styles.countdownTimer}>
        <span className={styles.countdownIcon}>&#9202;</span>
        <span>{secondsLeft}s</span>
      </div>
      <div className={styles.countdownProgress}>
        <div
          className={styles.countdownProgressBar}
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </div>
  );
}
