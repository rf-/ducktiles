export type Dimensions = [width: number, height: number];

export type BBox = [minX: number, maxX: number, minY: number, maxY: number];

export type Point = [x: number, y: number];

export type PointOffset = [dx: number, dy: number];

export type TileId = number & { __brand: "TileId" };

export type Tile = {
  id: TileId;
  char: string;
  offset: PointOffset; // top left corner, relative to center of screen
  ghost?: boolean;
};
