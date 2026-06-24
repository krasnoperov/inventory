/** Clock-style playback time like 1:23 or 12:05 from seconds. Non-finite or negative clamps to 0:00. */
export function formatPlaybackTime(seconds: number | null | undefined): string {
  const value = !seconds || !Number.isFinite(seconds) || seconds < 0 ? 0 : seconds;
  const total = Math.floor(value);
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/** Human-readable byte size, e.g. 245 KB / 1.8 MB. Returns null for empty input. */
export function formatBytes(bytes: number | null | undefined): string | null {
  if (!bytes || bytes <= 0) return null;
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? value : value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
  return `${rounded} ${units[unit]}`;
}
