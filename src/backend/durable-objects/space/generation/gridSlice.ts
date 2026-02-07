/**
 * Grid Image Slicing Utility
 *
 * Extracts individual cells from a grid image using Cloudflare Image Resizing
 * (via `cf.image` on self-fetch) or returns CSS coordinates for local dev fallback.
 */

/**
 * Slice a single cell from a grid image using Cloudflare Image Resizing.
 * In production, fetches the grid image URL with cf.image crop parameters.
 *
 * @param gridImageUrl - Full URL to the grid image stored in R2
 * @param col - Column index (0-based)
 * @param row - Row index (0-based)
 * @param cellW - Width of each cell in pixels
 * @param cellH - Height of each cell in pixels
 * @returns ArrayBuffer of the cropped cell image
 */
export async function sliceGridCell(
  gridImageUrl: string,
  col: number,
  row: number,
  cellW: number,
  cellH: number
): Promise<{ buffer: ArrayBuffer; mimeType: string }> {
  const resp = await fetch(gridImageUrl, {
    cf: {
      image: {
        width: cellW,
        height: cellH,
        fit: 'crop',
        gravity: {
          x: col * cellW + cellW / 2,
          y: row * cellH + cellH / 2,
        },
      },
    },
  });

  if (!resp.ok) {
    throw new Error(`Failed to slice grid cell (${col},${row}): ${resp.status} ${resp.statusText}`);
  }

  const buffer = await resp.arrayBuffer();
  const mimeType = resp.headers.get('content-type') || 'image/webp';
  return { buffer, mimeType };
}

/**
 * Compute CSS background-position coordinates for displaying a cell
 * from a grid image without server-side slicing (local dev fallback).
 *
 * @param col - Column index (0-based)
 * @param row - Row index (0-based)
 * @param cols - Total columns in grid
 * @param rows - Total rows in grid
 * @returns CSS properties for background-position and background-size
 */
export function getCellCssPosition(
  col: number,
  row: number,
  cols: number,
  rows: number
): { backgroundPosition: string; backgroundSize: string } {
  const xPercent = cols > 1 ? (col / (cols - 1)) * 100 : 0;
  const yPercent = rows > 1 ? (row / (rows - 1)) * 100 : 0;
  return {
    backgroundPosition: `${xPercent}% ${yPercent}%`,
    backgroundSize: `${cols * 100}% ${rows * 100}%`,
  };
}

/**
 * Grid layout configurations for rotation sprite sheets.
 */
export const ROTATION_GRID_LAYOUTS: Record<string, { rows: number; cols: number; directions: string[] }> = {
  '4-directional': {
    rows: 1,
    cols: 4,
    directions: ['S', 'E', 'N', 'W'],
  },
  '8-directional': {
    rows: 2,
    cols: 4,
    directions: ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'],
  },
  'turnaround': {
    rows: 1,
    cols: 5,
    directions: ['front', '3/4-front', 'side', '3/4-back', 'back'],
  },
};
