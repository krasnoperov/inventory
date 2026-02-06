/**
 * Spiral Order Generator
 *
 * BFS from center outward for tile generation order.
 * Ensures each new tile has maximal completed neighbors for adjacency refs.
 */

/**
 * Generate a BFS spiral order from the center of a grid outward.
 * Returns array of [x, y] coordinates starting from center.
 */
export function getSpiralOrder(w: number, h: number): [number, number][] {
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  const visited = new Set<string>();
  const queue: [number, number][] = [[cx, cy]];
  const result: [number, number][] = [];
  visited.add(`${cx},${cy}`);

  while (queue.length > 0) {
    const [x, y] = queue.shift()!;
    result.push([x, y]);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      const key = `${nx},${ny}`;
      if (nx >= 0 && nx < w && ny >= 0 && ny < h && !visited.has(key)) {
        visited.add(key);
        queue.push([nx, ny]);
      }
    }
  }

  return result;
}
