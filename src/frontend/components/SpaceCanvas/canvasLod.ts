// Level-of-detail threshold for the Space canvas. Below this zoom an asset
// card is only a handful of pixels wide, so rendering its real thumbnail costs
// more than it conveys: we greek the cards to cheap collection-tinted blocks
// instead, which also reads as a coloured cluster at a distance.
export const COMPACT_ZOOM = 0.5;

export function isCompactZoom(zoom: number): boolean {
  return zoom < COMPACT_ZOOM;
}
