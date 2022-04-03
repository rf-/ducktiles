import { tileGap, tileSize } from "./config";
import {
  Dimensions,
  Tile,
  TileId,
  Point,
  PointOffset,
  BBox,
  PointerId,
} from "./types";
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
import intersection from "lodash/intersection";

export type Action =
  | { type: "keyDown"; event: KeyboardEvent }
  | {
      type: "pointerDown";
      point: Point;
      pointerId: PointerId;
      isPrimary: boolean;
    }
  | {
      type: "pointerMove";
      point: Point;
      pointerId: PointerId;
      isPrimary: boolean;
    }
  | {
      type: "pointerUp";
      point: Point;
      pointerId: PointerId;
      isPrimary: boolean;
    }
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

type PreviewTiles = Record<TileId, Tile>;

type ActiveMove = {
  origin: Point;
  position: Point;
  tileIds: Array<TileId>;
  preview: PreviewTiles;
};

export type State = {
  tiles: Array<Tile>;
  animatingTileMovement: boolean;
  inputLetters: string | null;
  inputPreview: PreviewTiles;
  windowDimensions: Dimensions;
  activeMoves: Record<PointerId, ActiveMove>;
  selectOrigin: Point | null;
  primaryPointerPosition: Point;
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
  animatingTileMovement: false,
  inputLetters: null,
  inputPreview: {},
  primaryPointerPosition: [window.innerWidth / 2, window.innerHeight / 2],
  windowDimensions: [window.innerWidth, window.innerHeight],
  activeMoves: [],
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
      if (key === " " || key === "Escape" || key === "Enter" || key === "?") {
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

    if (key === "?" && !state.showingHelp && state.inputLetters == null) {
      return reducer(state, { type: "showHelp" });
    }

    return state;
  }

  if (action.type === "pointerDown") {
    if (state.inputLetters != null) return state;

    // If the event has the `isPrimary` flag but we think we already have an
    // active gesture, it means something weird happened like the user
    // activating the iPad dock. We can just clear out our existing gesture
    // state and move on.
    if (
      action.isPrimary &&
      (state.selectOrigin != null || Object.keys(state.activeMoves).length > 0)
    ) {
      return reducer(
        {
          ...state,
          selectOrigin: null,
          activeMoves: {},
        },
        action
      );
    }

    // Otherwise, if we really do have a select gesture happening, ignore this
    // touch.
    if (state.selectOrigin != null) return state;

    let topTileAtPoint: Tile | undefined = findTilesOverlappingBox(
      state,
      action.point,
      action.point
    ).slice(-1)[0];

    // If we weren't on a tile, try again with extra padding in case they just
    // barely missed. Phone and tablet users get larger buffers.
    if (topTileAtPoint == null) {
      const bufferDelta: PointOffset = state.useTouchUI
        ? Math.min(...state.windowDimensions) >= 600
          ? [20, 20]
          : [10, 10]
        : [5, 5];

      topTileAtPoint = findTilesOverlappingBox(
        state,
        subtract(action.point, bufferDelta),
        add(action.point, bufferDelta)
      ).slice(-1)[0];
    }

    const isMoving = Object.keys(state.activeMoves).length > 0;

    const touchedTile = topTileAtPoint; // freeze type

    if (!touchedTile) {
      if (isMoving) {
        // Stray multitouch tap; ignore it.
        return state;
      } else {
        // Start a selection box.
        return {
          ...state,
          selectOrigin: action.point,
          primaryPointerPosition: action.point,
          selectedTileIds: [],
        };
      }
    }

    const topTileIsMoving = Object.values(state.activeMoves).some((move) =>
      move.tileIds.includes(touchedTile.id)
    );
    const topTileIsSelected = state.selectedTileIds.includes(touchedTile.id);

    // Tile is already part of an active move; ignore it.
    if (topTileIsMoving) return state;

    // If no other move is active, and this tile was already selected, we need
    // to move all selected tiles. Otherwise we're just moving this tile.
    const movingTileIds =
      !isMoving && topTileIsSelected ? state.selectedTileIds : [touchedTile.id];

    // If no other move is active and this tile was *not* already selected, we
    // want to make this the only selected tile. Otherwise, add it to the
    // selection if necessary.
    const selectedTileIds =
      !isMoving && !topTileIsSelected
        ? [touchedTile.id]
        : topTileIsSelected
        ? state.selectedTileIds
        : [...state.selectedTileIds, touchedTile.id];

    return {
      ...state,
      animatingTileMovement: false,
      appearingTileIds: [],
      activeMoves: {
        ...state.activeMoves,
        [action.pointerId]: {
          origin: action.point,
          position: action.point,
          tileIds: movingTileIds,
          preview: {},
        },
      },
      selectedTileIds,
    };
  }

  if (action.type === "pointerMove") {
    const primaryPointerPosition = action.isPrimary
      ? action.point
      : state.primaryPointerPosition;

    if (state.inputLetters != null && action.isPrimary) {
      return {
        ...state,
        primaryPointerPosition,
        inputPreview: keyBy(
          placeNewTiles(state, state.inputLetters, action.point),
          (tile) => tile.id
        ),
      };
    }

    if (state.selectOrigin && action.isPrimary) {
      const selectedTileIds = findTilesOverlappingBox(
        state,
        state.selectOrigin,
        action.point
      ).map((tile) => tile.id);

      return {
        ...state,
        primaryPointerPosition,
        selectedTileIds,
      };
    }

    const relevantMove = state.activeMoves[action.pointerId];

    if (relevantMove == null) {
      return {
        ...state,
        primaryPointerPosition,
      };
    }

    const offsetDelta = subtract(action.point, relevantMove.origin);

    // If necessary, ensure that all tiles stay inside the window boundaries
    const movingTiles = state.tiles.filter((tile) =>
      relevantMove.tileIds.includes(tile.id)
    );
    const windowCenter = scale(state.windowDimensions, 0.5);
    const cornersBBox = calculateBoundingBox(
      ...movingTiles.map((tile) => add(tile.offset, windowCenter, offsetDelta))
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

    const preview = Object.fromEntries(
      state.tiles
        .filter((tile) => relevantMove.tileIds.includes(tile.id))
        .map((tile) => [
          tile.id,
          {
            ...tile,
            offset: add(tile.offset, offsetDelta, adjustmentDelta),
          },
        ])
    );

    return {
      ...state,
      activeMoves: {
        ...state.activeMoves,
        [action.pointerId]: {
          ...state.activeMoves[action.pointerId],
          position: action.point,
          preview,
        },
      },
      primaryPointerPosition,
    };
  }

  if (action.type === "pointerUp") {
    if (state.inputLetters != null && action.isPrimary) {
      return reducer(state, { type: "commitAddTiles" });
    }

    if (state.selectOrigin && action.isPrimary) {
      return {
        ...state,
        selectOrigin: null,
      };
    }

    const { [action.pointerId]: relevantMove, ...otherMoves } =
      state.activeMoves;

    if (relevantMove == null) {
      return state;
    }

    return {
      ...state,
      tiles: state.tiles.map((tile) => relevantMove.preview[tile.id] ?? tile),
      undoStack: [...state.undoStack, state.tiles],
      redoStack: [],
      activeMoves: otherMoves,
      selectedTileIds: action.isPrimary
        ? state.selectedTileIds
        : difference(state.selectedTileIds, relevantMove.tileIds),
    };
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
      animatingTileMovement: false,
      appearingTileIds: [],
    };
  }

  if (action.type === "startAddTiles") {
    const inputLetters = "";

    return {
      ...state,
      inputLetters,
      inputPreview: keyBy(
        placeNewTiles(state, inputLetters, state.primaryPointerPosition),
        (tile) => tile.id
      ),
      selectedTileIds: [],
      animatingTileMovement: false,
      appearingTileIds: [],
      showingZeroState: false,
    };
  }

  if (action.type === "backspaceAddTilesInput") {
    const inputLetters = state.inputLetters?.slice(0, -1) ?? "";

    return {
      ...state,
      inputLetters,
      inputPreview: keyBy(
        placeNewTiles(state, inputLetters, state.primaryPointerPosition),
        (tile) => tile.id
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
      inputPreview: keyBy(
        placeNewTiles(state, inputLetters, state.primaryPointerPosition),
        (tile) => tile.id
      ),
    };
  }

  if (action.type === "cancelAddTiles") {
    return {
      ...state,
      inputLetters: null,
      inputPreview: {},
    };
  }

  if (action.type === "commitAddTiles") {
    if (!state.inputLetters) return reducer(state, { type: "cancelAddTiles" });

    return {
      ...state,
      tiles: state.tiles.concat(Object.values(state.inputPreview)),
      undoStack: [...state.undoStack, state.tiles],
      redoStack: [],
      inputLetters: null,
      inputPreview: {},
      animatingTileMovement: false,
      appearingTileIds: Object.values(state.inputPreview).map(
        (tile) => tile.id
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
      animatingTileMovement: false,
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
      animatingTileMovement: true,
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
      animatingTileMovement: true,
      appearingTileIds: difference(
        newTiles.map((tile) => tile.id),
        state.tiles.map((tile) => tile.id)
      ),
      selectedTileIds: intersection(
        newTiles.map((tile) => tile.id),
        state.selectedTileIds
      ),
      activeMoves: {},
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
      animatingTileMovement: true,
      appearingTileIds: difference(
        newTiles.map((tile) => tile.id),
        state.tiles.map((tile) => tile.id)
      ),
      selectedTileIds: intersection(
        newTiles.map((tile) => tile.id),
        state.selectedTileIds
      ),
      activeMoves: {},
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
