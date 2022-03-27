import { BBox, Dimensions, Point } from "./types";
import unzip from "lodash/unzip";
import sum from "lodash/sum";
import { calculateFooterHeight } from "./config";

export function add<T extends [number, number]>(...vecs: Array<T>): T {
  const [xs, ys] = unzip(vecs);
  return [sum(xs), sum(ys)] as T;
}

export function subtract<T extends [number, number]>(vec1: T, vec2: T): T {
  return [vec1[0] - vec2[0], vec1[1] - vec2[1]] as T;
}

export function scale<T extends [number, number]>(
  vec: T,
  factor: number
): Dimensions {
  return [vec[0] * factor, vec[1] * factor];
}

export function calculateBoundingBox(...points: Array<Point>): BBox {
  const [xValues, yValues] = unzip(points);
  return [
    Math.min(...xValues),
    Math.max(...xValues),
    Math.min(...yValues),
    Math.max(...yValues),
  ];
}

export function calculateBBoxCorners(
  bbox: BBox
): [topLeft: Point, bottomRight: Point] {
  return [
    [bbox[0], bbox[2]],
    [bbox[1], bbox[3]],
  ];
}

export function calculateBBoxDimensions(bbox: BBox): Dimensions {
  return [bbox[1] - bbox[0], bbox[3] - bbox[2]];
}

export function calculateFullWindowBBox(windowDimensions: Dimensions): BBox {
  return [0, windowDimensions[0], 0, windowDimensions[1]];
}

export function calculateSmallWindowBBox(windowDimensions: Dimensions): BBox {
  const footerHeight = calculateFooterHeight(windowDimensions[0]);

  return [0, windowDimensions[0], 0, windowDimensions[1] - footerHeight];
}

export function calculateSmallOffsetBBox(windowDimensions: Dimensions): BBox {
  const footerHeight = calculateFooterHeight(windowDimensions[0]);

  return [
    -windowDimensions[0] / 2,
    windowDimensions[0] / 2,
    -windowDimensions[1] / 2,
    windowDimensions[1] / 2 - footerHeight,
  ];
}

export function clampShapeTopLeft(
  shapeTopLeft: Point,
  shapeDimensions: Dimensions,
  boundaries: BBox
): Point {
  let adjustedTopLeft = shapeTopLeft.slice() as Point;

  if (adjustedTopLeft[0] < boundaries[0]) {
    adjustedTopLeft[0] = boundaries[0];
  } else if (adjustedTopLeft[0] + shapeDimensions[0] > boundaries[1]) {
    adjustedTopLeft[0] = boundaries[1] - shapeDimensions[0];
  }

  if (adjustedTopLeft[1] < boundaries[2]) {
    adjustedTopLeft[1] = boundaries[2];
  } else if (adjustedTopLeft[1] + shapeDimensions[1] > boundaries[3]) {
    adjustedTopLeft[1] = boundaries[3] - shapeDimensions[1];
  }

  return adjustedTopLeft;
}
