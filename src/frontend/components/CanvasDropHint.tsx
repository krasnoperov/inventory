import styles from './CanvasDropHint.module.css';

interface CanvasDropHintProps {
  scope: string;
  message: string;
  detail?: string;
}

export function CanvasDropHint({ scope, message, detail }: CanvasDropHintProps) {
  return (
    <div className={styles.hint} role="status">
      <span className={styles.scope}>{scope}</span>
      <span className={styles.message}>{message}</span>
      {detail && <span className={styles.detail}>{detail}</span>}
    </div>
  );
}

export default CanvasDropHint;
