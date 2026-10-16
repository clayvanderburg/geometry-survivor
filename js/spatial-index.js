// Point broad phase; callers retain their exact distance/shape checks.
export class SpatialIndex {
  constructor(cellSize = 128) {
    this.cellSize = cellSize;
    this.cells = new Map();
    this.locations = new Map();
  }

  key(x, y) { return Math.floor(x / this.cellSize) + ',' + Math.floor(y / this.cellSize); }

  rebuild(items) {
    this.cells.clear();
    this.locations.clear();
    for (const item of items) this.update(item);
  }

  update(item) {
    const key = this.key(item.x, item.y);
    const previous = this.locations.get(item);
    if (previous === key) return;
    if (previous !== undefined) {
      const cell = this.cells.get(previous);
      cell.delete(item);
      if (!cell.size) this.cells.delete(previous);
    }
    if (!this.cells.has(key)) this.cells.set(key, new Set());
    this.cells.get(key).add(item);
    this.locations.set(item, key);
  }

  *query(x, y, radius) {
    const minX = Math.floor((x - radius) / this.cellSize);
    const maxX = Math.floor((x + radius) / this.cellSize);
    const minY = Math.floor((y - radius) / this.cellSize);
    const maxY = Math.floor((y + radius) / this.cellSize);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cy = minY; cy <= maxY; cy++) {
        const cell = this.cells.get(cx + ',' + cy);
        if (cell) yield* cell;
      }
    }
  }
}
