export interface LaidOutTile {
  index: number;
  width: number;
  height: number;
}

export interface TileRow {
  height: number;
  tiles: LaidOutTile[];
}

// Past this many tiles trying every split gets slow; even splits are good enough at that size.
const MAX_TILES_FOR_EVERY_SPLIT = 10;

const everySplit = (count: number): number[][] => {
  const splits: number[][] = [];
  for (let mask = 0; mask < 2 ** (count - 1); mask += 1) {
    const sizes = [1];
    for (let bit = 0; bit < count - 1; bit += 1) {
      if (mask & (1 << bit)) sizes.push(1);
      else sizes[sizes.length - 1] += 1;
    }
    splits.push(sizes);
  }
  return splits;
};

const evenSplits = (count: number): number[][] =>
  Array.from({ length: count }, (_, index) => {
    const rows = index + 1;
    return Array.from({ length: rows }, (_row, row) => Math.floor(count / rows) + (row < count % rows ? 1 : 0));
  });

/**
 * Splits the tiles into rows so that every tile keeps the shape of its video and the videos cover
 * as much of the stage as possible. Nothing is cropped, because no tile differs from its video.
 */
export function layoutTiles(aspects: number[], width: number, height: number, gap: number): TileRow[] {
  if (aspects.length === 0 || width <= 0 || height <= 0) return [];
  const splits = aspects.length <= MAX_TILES_FOR_EVERY_SPLIT ? everySplit(aspects.length) : evenSplits(aspects.length);

  let best: TileRow[] = [];
  let bestArea = -1;
  for (const split of splits) {
    let start = 0;
    const rows = split.map((size) => {
      const indexes = Array.from({ length: size }, (_, offset) => start + offset);
      start += size;
      const aspectSum = indexes.reduce((sum, index) => sum + aspects[index], 0);
      return { indexes, aspectSum, height: (width - gap * (size - 1)) / aspectSum };
    });

    const free = height - gap * (rows.length - 1);
    const natural = rows.reduce((sum, row) => sum + row.height, 0);
    if (free <= 0) continue;
    const scale = Math.min(1, free / natural);

    let area = 0;
    const laidOut = rows.map((row) => {
      const rowHeight = Math.floor(row.height * scale);
      const tiles = row.indexes.map((index) => {
        const tileWidth = Math.floor(rowHeight * aspects[index]);
        area += tileWidth * rowHeight;
        return { index, width: tileWidth, height: rowHeight };
      });
      return { height: rowHeight, tiles };
    });
    if (area > bestArea) {
      bestArea = area;
      best = laidOut;
    }
  }
  return best;
}
