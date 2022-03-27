import { tileGap, tileSize } from "./config";
import { Dimensions, Tile, TileId, Point, PointOffset, BBox } from "./types";
import keyBy from "lodash/keyBy";
import zip from "lodash/zip";
import shuffle from "lodash/shuffle";
import isEqual from "lodash/isEqual";
import assertNever from "./assertNever";
import {
  add,
  calculateBBoxCorners,
  calculateBBoxDimensions,
  calculateBoundingBox,
  calculateFullWindowBBox,
  calculateSmallOffsetBBox,
  calculateSmallWindowBBox,
  clampShapeTopLeft,
  scale,
  subtract,
} from "./geometry";
import chunk from "lodash/chunk";

export type Action =
  | { type: "keyDown"; event: KeyboardEvent }
  | { type: "pointerDown"; point: Point }
  | { type: "pointerMove"; point: Point }
  | { type: "pointerUp"; point: Point }
  | { type: "windowResize"; dimensions: Dimensions }
  | { type: "startAddTiles" }
  | { type: "backspaceAddTilesInput" }
  | { type: "changeAddTilesInput"; input: string }
  | { type: "cancelAddTiles" }
  | { type: "commitAddTiles" }
  | { type: "addTilesWithPrompt" }
  | { type: "shuffle" }
  | { type: "delete" }
  | { type: "enableTouchUI" }
  | { type: "disableTouchUI" };

export type State = {
  tiles: Array<Tile>;
  animating: boolean;
  inputLetters: string | null;
  previewTiles: Array<Tile> | null;
  windowDimensions: Dimensions;
  moveOrigin: Point | null;
  selectOrigin: Point | null;
  pointerPosition: Point;
  selectedTileIds: Array<TileId>;
  useTouchUI: boolean;
};

export const initialState: State = {
  tiles: [],
  animating: false,
  inputLetters: null,
  previewTiles: null,
  pointerPosition: [0, 0],
  windowDimensions: [window.innerWidth, window.innerHeight],
  moveOrigin: null,
  selectOrigin: null,
  selectedTileIds: [],
  useTouchUI: false,
};

function findTilesOverlappingBox(
  state: State,
  corner1: Point,
  corner2: Point
): Array<Tile> {
  const [minX, maxX, minY, maxY] = calculateBoundingBox(corner1, corner2);

  return state.tiles.filter((tile) => {
    const [tileMinX, tileMinY] = add(
      tile.offset,
      scale(state.windowDimensions, 0.5)
    );
    const tileMaxX = tileMinX + tileSize;
    const tileMaxY = tileMinY + tileSize;

    return (
      tileMinX <= maxX &&
      tileMaxX >= minX &&
      tileMinY <= maxY &&
      tileMaxY >= minY
    );
  });
}

let nextId = 0;

function calculateTilesSize(numberOfTiles: number) {
  return tileSize * numberOfTiles + tileGap * (numberOfTiles - 1);
}

function placeNewTiles(
  state: State,
  rawText: string,
  point: Point
): Array<Tile> {
  const chars = (rawText || "type here").split("");

  const windowBBox = calculateSmallWindowBBox(state.windowDimensions);

  // Reduce the number of tiles per row until it can fit
  let maxRowTiles = chars.length;
  let overallWidth: number;
  for (;;) {
    overallWidth = calculateTilesSize(maxRowTiles);

    // If everything fits, we're good
    if (
      point[0] - overallWidth / 2 >= windowBBox[0] &&
      point[0] + overallWidth / 2 <= windowBBox[1]
    ) {
      break;
    }

    // If we're already just a vertical line, we're done anyway
    if (maxRowTiles === 1) break;

    maxRowTiles--;
  }

  // Now lay out the tiles in that number of rows, centered on the cursor
  const tilesByRow = chunk(chars, maxRowTiles);
  const overallHeight = calculateTilesSize(tilesByRow.length);
  const startX = point[0] - overallWidth / 2;
  const startY = point[1] - overallHeight / 2;

  // Clamp the locations to fit inside the window if possible
  const [adjustedStartX, adjustedStartY] = clampShapeTopLeft(
    [startX, startY],
    [overallWidth, overallHeight],
    windowBBox
  );

  return chars.map((char, idx) => ({
    id: nextId++ as TileId,
    char,
    offset: [
      adjustedStartX +
        (idx % maxRowTiles) * (tileSize + tileGap) -
        state.windowDimensions[0] / 2,
      adjustedStartY +
        Math.floor(idx / maxRowTiles) * (tileSize + tileGap) -
        state.windowDimensions[1] / 2,
    ],
    ghost: !rawText,
  }));
}

export function reducer(state: State = initialState, action: Action): State {
  if (action.type === "keyDown") {
    const { event } = action;
    const key = event.key;

    if (key === " " && state.inputLetters == null) {
      event.preventDefault();
      return reducer(state, { type: "startAddTiles" });
    }

    if (key === "Backspace" && state.inputLetters != null) {
      return reducer(state, { type: "backspaceAddTilesInput" });
    }

    if (
      (key === "Backspace" || key === "Delete") &&
      state.selectedTileIds.length > 0
    ) {
      return reducer(state, { type: "delete" });
    }

    if (key === "Escape" && state.inputLetters != null) {
      return reducer(state, { type: "cancelAddTiles" });
    }

    if (key === "Enter" && state.inputLetters != null) {
      return reducer(state, { type: "commitAddTiles" });
    }

    return state;
  }

  if (action.type === "pointerDown") {
    if (state.inputLetters != null) return state;

    const topTileAtPoint = findTilesOverlappingBox(
      state,
      action.point,
      action.point
    ).at(-1);

    if (topTileAtPoint) {
      return {
        ...state,
        animating: false,
        moveOrigin: action.point,
        pointerPosition: action.point,
        selectedTileIds: state.selectedTileIds.includes(topTileAtPoint.id)
          ? state.selectedTileIds
          : [topTileAtPoint.id],
      };
    }

    return {
      ...state,
      selectOrigin: action.point,
      pointerPosition: action.point,
      selectedTileIds: [],
    };
  }

  if (action.type === "pointerMove") {
    if (state.inputLetters != null) {
      return {
        ...state,
        pointerPosition: action.point,
        previewTiles: state.tiles.concat(
          placeNewTiles(state, state.inputLetters, action.point)
        ),
      };
    }

    if (state.moveOrigin) {
      const offsetDelta = subtract(action.point, state.moveOrigin);

      // If necessary, ensure that all tiles stay inside the window boundaries
      const selectedTiles = state.tiles.filter((tile) =>
        state.selectedTileIds.includes(tile.id)
      );
      const windowCenter = scale(state.windowDimensions, 0.5);
      const cornersBBox = calculateBoundingBox(
        ...selectedTiles.map((tile) =>
          add(tile.offset, windowCenter, offsetDelta)
        )
      );
      const tilesBBox: BBox = [
        cornersBBox[0],
        cornersBBox[1] + tileSize,
        cornersBBox[2],
        cornersBBox[3] + tileSize,
      ];
      const tilesBBoxTopLeft = calculateBBoxCorners(tilesBBox)[0];
      const adjustedTopLeft = clampShapeTopLeft(
        tilesBBoxTopLeft,
        calculateBBoxDimensions(tilesBBox),
        calculateFullWindowBBox(state.windowDimensions)
      );
      const adjustmentDelta = subtract(adjustedTopLeft, tilesBBoxTopLeft);

      const previewTiles = state.tiles.map((tile) =>
        state.selectedTileIds.includes(tile.id)
          ? {
              ...tile,
              offset: add(tile.offset, offsetDelta, adjustmentDelta),
            }
          : tile
      );

      return {
        ...state,
        previewTiles,
        pointerPosition: action.point,
      };
    }

    if (state.selectOrigin) {
      const selectedTileIds = findTilesOverlappingBox(
        state,
        state.selectOrigin,
        action.point
      ).map((tile) => tile.id);

      return {
        ...state,
        pointerPosition: action.point,
        selectedTileIds,
      };
    }

    return {
      ...state,
      pointerPosition: action.point,
    };
  }

  if (action.type === "pointerUp") {
    if (state.inputLetters != null) {
      return reducer(state, { type: "commitAddTiles" });
    }

    if (state.moveOrigin) {
      return {
        ...state,
        tiles: state.previewTiles ?? state.tiles,
        previewTiles: null,
        moveOrigin: null,
      };
    }

    if (state.selectOrigin) {
      return {
        ...state,
        selectOrigin: null,
      };
    }

    return state;
  }

  if (action.type === "windowResize") {
    const offsetBBox = calculateSmallOffsetBBox(state.windowDimensions);

    return {
      ...state,
      windowDimensions: action.dimensions,
      tiles: state.tiles.map((tile) => ({
        ...tile,
        offset: clampShapeTopLeft(
          tile.offset,
          [tileSize, tileSize],
          offsetBBox
        ),
      })),
      animating: false,
    };
  }

  if (action.type === "startAddTiles") {
    if (state.useTouchUI) {
      return reducer(state, { type: "addTilesWithPrompt" });
    }

    const inputLetters = "";

    return {
      ...state,
      inputLetters,
      previewTiles: state.tiles.concat(
        placeNewTiles(state, inputLetters, state.pointerPosition)
      ),
      selectedTileIds: [],
      animating: false,
    };
  }

  if (action.type === "backspaceAddTilesInput") {
    const inputLetters = state.inputLetters?.slice(0, -1) ?? "";

    return {
      ...state,
      inputLetters,
      previewTiles: state.tiles.concat(
        placeNewTiles(state, inputLetters, state.pointerPosition)
      ),
    };
  }

  if (action.type === "changeAddTilesInput") {
    const inputLetters =
      state.inputLetters +
      (action.input === " " ? action.input : action.input.trim());

    return {
      ...state,
      inputLetters,
      previewTiles: state.tiles.concat(
        placeNewTiles(state, inputLetters, state.pointerPosition)
      ),
    };
  }

  if (action.type === "cancelAddTiles") {
    return {
      ...state,
      inputLetters: null,
      previewTiles: null,
    };
  }

  if (action.type === "commitAddTiles") {
    if (!state.inputLetters) return reducer(state, { type: "cancelAddTiles" });

    return {
      ...state,
      tiles: state.previewTiles ?? state.tiles,
      inputLetters: null,
      previewTiles: null,
    };
  }

  if (action.type === "addTilesWithPrompt") {
    const text = prompt("Enter some letters!");
    if (!text) return state;

    return {
      ...state,
      tiles: state.tiles.concat(
        placeNewTiles(state, text, [
          state.windowDimensions[0] / 2,
          state.windowDimensions[1] / 2,
        ])
      ),
      selectedTileIds: [],
    };
  }

  if (action.type === "shuffle") {
    const tilesById = keyBy(state.tiles, (tile) => tile.id);
    const tileIds =
      state.selectedTileIds.length > 1
        ? state.selectedTileIds
        : state.tiles.map((tile) => tile.id);

    const offsets = tileIds.map((id) => tilesById[id].offset);

    let newOffsets = offsets;
    while (isEqual(newOffsets, offsets)) {
      newOffsets = shuffle(offsets);
    }
    const newOffsetById: Record<TileId, PointOffset> = Object.fromEntries(
      zip(tileIds, newOffsets)
    );

    return {
      ...state,
      tiles: state.tiles.map((tile) =>
        newOffsetById[tile.id]
          ? { ...tile, offset: newOffsetById[tile.id] }
          : tile
      ),
      animating: true,
    };
  }

  if (action.type === "delete") {
    return {
      ...state,
      tiles: state.tiles.filter(
        (tile) => !state.selectedTileIds.includes(tile.id)
      ),
      selectedTileIds: [],
    };
  }

  if (action.type === "enableTouchUI") {
    return {
      ...state,
      useTouchUI: true,
    };
  }

  if (action.type === "disableTouchUI") {
    return {
      ...state,
      useTouchUI: false,
    };
  }

  assertNever(action);

  return state;
}
