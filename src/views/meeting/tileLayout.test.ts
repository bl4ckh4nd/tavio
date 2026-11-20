import { describe, expect, it } from 'vitest';
import { layoutTiles } from './tileLayout';

const PORTRAIT = 9 / 16;
const LANDSCAPE = 16 / 9;

const tilesOf = (rows: ReturnType<typeof layoutTiles>) => rows.flatMap((row) => row.tiles);

const expectFits = (rows: ReturnType<typeof layoutTiles>, width: number, height: number, gap: number) => {
  const used = rows.reduce((sum, row) => sum + row.height, 0) + gap * (rows.length - 1);
  expect(used).toBeLessThanOrEqual(height);
  for (const row of rows) {
    const rowWidth = row.tiles.reduce((sum, tile) => sum + tile.width, 0) + gap * (row.tiles.length - 1);
    expect(rowWidth).toBeLessThanOrEqual(width);
  }
};

describe('layoutTiles', () => {
  it('gives one portrait video the whole phone stage in its own shape', () => {
    const rows = layoutTiles([PORTRAIT], 374, 700, 4);
    expect(rows).toHaveLength(1);
    expect(rows[0].height).toBe(664);
    expect(rows[0].tiles[0].width).toBe(373);
  });

  it('stacks two landscape videos on a phone instead of cropping them side by side', () => {
    const rows = layoutTiles([LANDSCAPE, LANDSCAPE], 374, 700, 4);
    expect(rows.map((row) => row.tiles.length)).toEqual([1, 1]);
  });

  it('puts two portrait videos side by side on a wide stage', () => {
    const rows = layoutTiles([PORTRAIT, PORTRAIT], 1200, 640, 8);
    expect(rows.map((row) => row.tiles.length)).toEqual([2]);
  });

  it('keeps the order of the tiles and the shape of every video', () => {
    const aspects = [LANDSCAPE, PORTRAIT, LANDSCAPE, PORTRAIT, LANDSCAPE];
    const tiles = tilesOf(layoutTiles(aspects, 1200, 640, 8));
    expect(tiles.map((tile) => tile.index)).toEqual([0, 1, 2, 3, 4]);
    for (const tile of tiles) {
      expect(Math.abs(tile.width / tile.height - aspects[tile.index])).toBeLessThan(0.05);
    }
  });

  it('never leaves the stage, also with more tiles than can be tried one by one', () => {
    for (const count of [1, 2, 3, 4, 6, 9, 16, 25]) {
      const aspects = Array.from({ length: count }, (_, index) => (index % 3 === 0 ? PORTRAIT : LANDSCAPE));
      const rows = layoutTiles(aspects, 960, 540, 8);
      expect(tilesOf(rows)).toHaveLength(count);
      expectFits(rows, 960, 540, 8);
    }
  });

  it('returns nothing until the stage has a size', () => {
    expect(layoutTiles([LANDSCAPE], 0, 0, 8)).toEqual([]);
  });
});
