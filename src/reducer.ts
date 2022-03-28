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
import debounce from "lodash/debounce";
import difference from "lodash/difference";

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
  | { type: "addTilesFromPrompt"; text: string }
  | { type: "selectAll" }
  | { type: "shuffle" }
  | { type: "delete" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "enableTouchUI" }
  | { type: "disableTouchUI" }
  | { type: "showHelp" }
  | { type: "hideHelp" };

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
  appearingTileIds: Array<TileId>;
  useTouchUI: boolean;
  undoStack: Array<Array<Tile>>;
  redoStack: Array<Array<Tile>>;
  showingZeroState: boolean;
  showingHelp: boolean;
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
  appearingTileIds: [],
  useTouchUI: false,
  undoStack: [],
  redoStack: [],
  showingZeroState: true,
  showingHelp: false,
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

function calculateTilesSize(numberOfTiles: number) {
  return tileSize * numberOfTiles + tileGap * (numberOfTiles - 1);
}

function placeNewTiles(
  state: State,
  rawText: string,
  point: Point
): Array<Tile> {
  const chars = (rawText || "type here").split("");

  const nextId = (state.tiles.slice(-1)[0]?.id ?? 0) + 1;
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
    id: (nextId + idx) as TileId,
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

function innerReducer(state: State = initialState, action: Action): State {
  if (action.type === "keyDown") {
    const { event } = action;
    const { key, ctrlKey, metaKey, shiftKey } = event;
    const isShortcut = ctrlKey || metaKey; // Windows and Mac respectively

    if (state.showingHelp) {
      if (key === " " || key === "Escape" || key === "Enter") {
        event.preventDefault();
        return reducer(state, { type: "hideHelp" });
      }
      return state;
    }

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

    if (key === "a" && isShortcut) {
      return reducer(state, { type: "selectAll" });
    }

    if (key === "s" && isShortcut) {
      event.preventDefault();
      return reducer(state, { type: "shuffle" });
    }

    if (key === "z" && !shiftKey && isShortcut) {
      return reducer(state, { type: "undo" });
    }

    if (((key === "z" && shiftKey) || key === "y") && isShortcut) {
      return reducer(state, { type: "redo" });
    }

    return state;
  }

  if (action.type === "pointerDown") {
    if (state.inputLetters != null) return state;

    const topTileAtPoint = findTilesOverlappingBox(
      state,
      action.point,
      action.point
    ).slice(-1)[0];

    if (topTileAtPoint) {
      return {
        ...state,
        animating: false,
        appearingTileIds: [],
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
        undoStack: [...state.undoStack, state.tiles],
        redoStack: [],
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

    // NOTE: We don't update history since it'll be too noisy
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
      appearingTileIds: [],
    };
  }

  if (action.type === "startAddTiles") {
    const inputLetters = "";

    return {
      ...state,
      inputLetters,
      previewTiles: state.tiles.concat(
        placeNewTiles(state, inputLetters, state.pointerPosition)
      ),
      selectedTileIds: [],
      animating: false,
      appearingTileIds: [],
      showingZeroState: false,
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
      undoStack: [...state.undoStack, state.tiles],
      redoStack: [],
      inputLetters: null,
      previewTiles: null,
      animating: false,
      appearingTileIds: difference(
        state.previewTiles?.map((tile) => tile.id),
        state.tiles.map((tile) => tile.id)
      ),
    };
  }

  if (action.type === "addTilesFromPrompt") {
    const newTiles = placeNewTiles(state, action.text, [
      state.windowDimensions[0] / 2,
      state.windowDimensions[1] / 2,
    ]);

    return {
      ...state,
      tiles: state.tiles.concat(newTiles),
      undoStack: [...state.undoStack, state.tiles],
      redoStack: [],
      selectedTileIds: [],
      showingZeroState: false,
      animating: false,
      appearingTileIds: newTiles.map((tile) => tile.id),
    };
  }

  if (action.type === "selectAll") {
    return {
      ...state,
      selectedTileIds: state.tiles.map((tile) => tile.id),
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
      undoStack: [...state.undoStack, state.tiles],
      redoStack: [],
      animating: true,
      appearingTileIds: [],
    };
  }

  if (action.type === "delete") {
    return {
      ...state,
      tiles:
        state.selectedTileIds.length > 0
          ? state.tiles.filter(
              (tile) => !state.selectedTileIds.includes(tile.id)
            )
          : [],
      undoStack: [...state.undoStack, state.tiles],
      redoStack: [],
      selectedTileIds: [],
    };
  }

  if (action.type === "undo") {
    const newTiles = state.undoStack.slice(-1)[0];
    if (newTiles == null) return state;

    return {
      ...state,
      tiles: newTiles,
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [state.tiles, ...state.redoStack],
      animating: true,
      appearingTileIds: difference(
        newTiles.map((tile) => tile.id),
        state.tiles.map((tile) => tile.id)
      ),
    };
  }

  if (action.type === "redo") {
    const newTiles = state.redoStack[0];
    if (newTiles == null) return state;

    return {
      ...state,
      tiles: newTiles,
      undoStack: [...state.undoStack, state.tiles],
      redoStack: state.redoStack.slice(1),
      animating: true,
      appearingTileIds: difference(
        newTiles.map((tile) => tile.id),
        state.tiles.map((tile) => tile.id)
      ),
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

  if (action.type === "showHelp") {
    return {
      ...state,
      showingHelp: true,
    };
  }

  if (action.type === "hideHelp") {
    return {
      ...state,
      showingHelp: false,
    };
  }

  assertNever(action);

  return state;
}

// Janky helpers from MDN -- these should be good enough for us despite the
// deprecation warnings.
function encodeBase64(data: any) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(data))));
}
function decodeBase64(str: string) {
  return JSON.parse(decodeURIComponent(escape(atob(str))));
}

// Debounce URL updates to avoid errors
const updateURL = debounce((tiles: Array<Tile>) => {
  window.history.replaceState(
    null,
    "",
    `#${tiles.length === 0 ? "" : encodeBase64(tiles)}`
  );
}, 100);

export function reducer(state: State, action: Action): State {
  const newState = innerReducer(state, action);

  if (state.tiles !== newState.tiles) {
    updateURL(newState.tiles);
  }

  return newState;
}

export function initializer(state: State): State {
  let { tiles, showingZeroState } = initialState;

  if (document.location.hash) {
    try {
      tiles = decodeBase64(document.location.hash.slice(1));
      showingZeroState = false;
    } catch (_err) {
      // Not valid JSON or whatever, ignore it
    }
  }

  return {
    ...state,
    tiles,
    showingZeroState,
  };
}
