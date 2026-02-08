/**
 * Grid Image Slicing Utility
 *
 * Extracts individual cells from a grid image using Cloudflare Image Resizing
 * (via `cf.image` on self-fetch) or returns CSS coordinates for local dev fallback.
 */

/**
 * Slice a single cell from a grid image using Cloudflare Image Resizing.
 * Uses `trim` to remove all pixels except the target cell region.
 *
 * @param gridImageUrl - Full URL to the grid image (served via Worker/R2)
 * @param col - Column index (0-based)
 * @param row - Row index (0-based)
 * @param gridCols - Total columns in the grid
 * @param gridRows - Total rows in the grid
 * @param imageWidth - Actual width of the grid image in pixels
 * @param imageHeight - Actual height of the grid image in pixels
 * @returns ArrayBuffer of the cropped cell image
 */
export async function sliceGridCell(
  gridImageUrl: string,
  col: number,
  row: number,
  gridCols: number,
  gridRows: number,
  imageWidth: number,
  imageHeight: number
): Promise<{ buffer: ArrayBuffer; mimeType: string }> {
  const cellW = imageWidth / gridCols;
  const cellH = imageHeight / gridRows;

  const trimLeft = Math.round(col * cellW);
  const trimTop = Math.round(row * cellH);
  const trimRight = Math.round(imageWidth - (col + 1) * cellW);
  const trimBottom = Math.round(imageHeight - (row + 1) * cellH);

  const resp = await fetch(gridImageUrl, {
    cf: {
      image: {
        trim: {
          top: trimTop,
          left: trimLeft,
          bottom: trimBottom,
          right: trimRight,
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
