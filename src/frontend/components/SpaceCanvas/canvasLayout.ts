// Canvas frame sizing + layout heuristics. Pure and unit-tested so the visual
// component stays thin.

export const FRAME_WIDTH = 460;
export const FRAME_GAP = 36;
// Cap columns so a giant space stays a navigable map rather than an endless
// horizontal wall.
export const MAX_COLUMNS = 8;

const HEADER_H = 64;
const ROW_H = 150;
const CARDS_PER_ROW = 3.2;

// Rough per-frame height before React Flow has measured the real DOM. Used to
// seed the masonry and pick a column count on first paint.
export function estimateFrameHeight(count: number): number {
  const rows = Math.max(1, Math.ceil(count / CARDS_PER_ROW));
  return HEADER_H + rows * (ROW_H + 9) + 16;
}

// Pick a column count so the packed masonry roughly matches the viewport's
// aspect ratio. This fills the screen instead of stacking frames into a tall
// narrow strip with empty margins on either side — and because the content is
// then about as wide as it is tall, the default fit zoom stays high enough to
// show real thumbnails rather than greeked blocks.
export function columnCountForLayout(
  totalContentHeight: number,
  viewportAspect: number,
  frameCount: number,
): number {
  if (frameCount <= 1) return 1;
  const aspect = Math.max(0.2, viewportAspect);
  const ideal = Math.sqrt((aspect * totalContentHeight) / (FRAME_WIDTH + FRAME_GAP));
  return Math.max(1, Math.min(frameCount, MAX_COLUMNS, Math.round(ideal)));
}
