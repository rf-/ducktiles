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
  calculateCentroid,
  calculateFullWindowBBox,
  calculateSmallOffsetBBox,
  clampShapeTopLeft,
  round,
  scale,
  subtract,
} from "./geometry";
import debounce from "lodash/debounce";
import difference from "lodash/difference";
import intersection from "lodash/intersection";
import union from "lodash/union";
import range from "lodash/range";

export type Action =
  | { type: "keyDown"; event: KeyboardEvent }
  | {
      type: "pointerDown";
      point: Point;
      pointerId: PointerId;
      isPrimary: boolean;
      hasModifier: boolean;
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
  | { type: "arrange" }
  | { type: "delete" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "enableTouchUI" }
  | { type: "disableTouchUI" }
  | { type: "showHelp" }
  | { type: "hideHelp" };

type PreviewTiles = Record<TileId, Tile>;

type ActiveSelection = {
  origin: Point;
  tileIds: Array<TileId>;
  deselecting: boolean;
};

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
  activeSelection: ActiveSelection | null;
  primaryPointerPosition: Point;
  selectedTileIds: Array<TileId>;
  appearingTileIds: Array<TileId>;
  useTouchUI: boolean;
  undoStack: Array<Array<Tile>>;
  redoStack: Array<Array<Tile>>;
  showingZeroState: boolean;
  showingHelp: boolean;
  showingArrangeToLine: boolean;
};

export const initialState: State = {
  tiles: [],
  animatingTileMovement: false,
  inputLetters: null,
  inputPreview: {},
  primaryPointerPosition: [window.innerWidth / 2, window.innerHeight / 2],
  windowDimensions: [window.innerWidth, window.innerHeight],
  activeMoves: [],
  activeSelection: null,
  selectedTileIds: [],
  appearingTileIds: [],
  useTouchUI: false,
  undoStack: [],
  redoStack: [],
  showingZeroState: true,
  showingHelp: false,
  showingArrangeToLine: false,
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

function calculateLinearTilePositions(
  center: Point,
  tilesCount: number,
  bbox: BBox
): Array<Point> {
  // Reduce the number of tiles per row until it can fit
  let maxRowTiles = tilesCount;
  let overallWidth: number;
  for (;;) {
    overallWidth = calculateTilesSize(maxRowTiles);

    // If everything fits, we're good
    if (
      center[0] - overallWidth / 2 >= bbox[0] &&
      center[0] + overallWidth / 2 <= bbox[1]
    ) {
      break;
    }

    // If we're already just a vertical line, we're done anyway
    if (maxRowTiles === 1) break;

    maxRowTiles--;
  }

  // Now lay out the tiles in that number of rows, centered on the cursor
  const overallHeight = calculateTilesSize(Math.ceil(tilesCount / maxRowTiles));
  const startX = center[0] - overallWidth / 2;
  const startY = center[1] - overallHeight / 2;

  // Clamp the locations to fit inside the window if possible
  const [adjustedStartX, adjustedStartY] = clampShapeTopLeft(
    [startX, startY],
    [overallWidth, overallHeight],
    bbox
  );

  return range(tilesCount).map((idx) => [
    adjustedStartX + (idx % maxRowTiles) * (tileSize + tileGap),
    adjustedStartY + Math.floor(idx / maxRowTiles) * (tileSize + tileGap),
  ]);
}

function placeNewTiles(
  state: State,
  rawText: string,
  center: Point
): Array<Tile> {
  const chars = (rawText || "type here").split("");
  const nextId = (state.tiles.slice(-1)[0]?.id ?? 0) + 1;

  const offsets = calculateLinearTilePositions(
    subtract(center, [
      state.windowDimensions[0] / 2,
      state.windowDimensions[1] / 2,
    ]),
    chars.length,
    calculateSmallOffsetBBox(state.windowDimensions)
  );

  return chars.map((char, idx) => ({
    id: (nextId + idx) as TileId,
    char,
    offset: offsets[idx],
    ghost: !rawText,
  }));
}

function shuffleTiles(
  state: State,
  tileIds: Array<TileId>,
  newOffsets?: Array<PointOffset>
): State {
  const tilesById = keyBy(state.tiles, (tile) => tile.id);
  const startingOffsets = tileIds.map((id) => tilesById[id].offset);

  let offsets = newOffsets ?? startingOffsets;
  while (isEqual(offsets, startingOffsets)) {
    offsets = shuffle(offsets);
  }
  const offsetById: Record<TileId, PointOffset> = Object.fromEntries(
    zip(tileIds, offsets)
  );

  return {
    ...state,
    tiles: state.tiles.map((tile) =>
      offsetById[tile.id] ? { ...tile, offset: offsetById[tile.id] } : tile
    ),
    undoStack: [...state.undoStack, state.tiles],
    redoStack: [],
    animatingTileMovement: true,
    appearingTileIds: [],
  };
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

    if (key === "s" && !shiftKey && isShortcut) {
      event.preventDefault();
      return reducer(state, { type: "shuffle" });
    }

    if (key === "s" && shiftKey && isShortcut) {
      event.preventDefault();
      return reducer(state, { type: "arrange" });
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
      (state.activeSelection || Object.keys(state.activeMoves).length > 0)
    ) {
      return reducer(
        {
          ...state,
          activeSelection: null,
          activeMoves: {},
        },
        action
      );
    }

    // Otherwise, if we really do have a select gesture happening, ignore this
    // touch.
    if (state.activeSelection) return state;

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
    const touchedTileIsMoving =
      touchedTile != null &&
      Object.values(state.activeMoves).some((move) =>
        move.tileIds.includes(touchedTile.id)
      );
    const touchedTileIsSelected =
      touchedTile != null && state.selectedTileIds.includes(touchedTile.id);

    // If they're clicking off all tiles, or on a tile with a modifier key, we
    // want to either start a selection or ignore it.
    if (touchedTile == null || action.hasModifier) {
      // Ignore stray multitouch taps during a move.
      if (isMoving) return state;

      // Start a selection box.
      return {
        ...state,
        activeSelection: {
          origin: action.point,
          tileIds: touchedTile == null ? [] : [touchedTile.id],
          deselecting: touchedTileIsSelected,
        },
        primaryPointerPosition: action.point,
        selectedTileIds: action.hasModifier ? state.selectedTileIds : [],
      };
    }

    // If the tile is already part of an active move, ignore it.
    if (touchedTileIsMoving) return state;

    // If no other move is active, and this tile was already selected, we need
    // to move all selected tiles. Otherwise we're just moving this tile.
    const movingTileIds =
      !isMoving && touchedTileIsSelected
        ? state.selectedTileIds
        : [touchedTile.id];

    // If no other move is active and this tile was *not* already selected, we
    // want to make this the only selected tile. Otherwise, add it to the
    // selection if necessary.
    const selectedTileIds =
      !isMoving && !touchedTileIsSelected
        ? [touchedTile.id]
        : touchedTileIsSelected
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

    if (state.activeSelection && action.isPrimary) {
      const overlappingTileIds = findTilesOverlappingBox(
        state,
        state.activeSelection.origin,
        action.point
      ).map((tile) => tile.id);

      return {
        ...state,
        activeSelection: {
          ...state.activeSelection,
          tileIds: overlappingTileIds,
        },
        primaryPointerPosition,
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

    if (state.activeSelection && action.isPrimary) {
      return {
        ...state,
        activeSelection: null,
        selectedTileIds: state.activeSelection.deselecting
          ? difference(state.selectedTileIds, state.activeSelection.tileIds)
          : union(state.selectedTileIds, state.activeSelection.tileIds),
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
      showingArrangeToLine: false,
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
      showingArrangeToLine: false,
    };
  }

  if (action.type === "selectAll") {
    return {
      ...state,
      selectedTileIds: state.tiles.map((tile) => tile.id),
    };
  }

  if (action.type === "shuffle") {
    const tileIds =
      state.selectedTileIds.length > 1
        ? state.selectedTileIds
        : state.tiles.map((tile) => tile.id);

    return shuffleTiles(state, tileIds);
  }

  if (action.type === "arrange") {
    const tilesById = keyBy(state.tiles, (tile) => tile.id);
    const tileIds =
      state.selectedTileIds.length > 1
        ? state.selectedTileIds
        : state.tiles.map((tile) => tile.id);

    const arrangeToLine = tileIds.length < 3 || state.showingArrangeToLine;

    const startingOffsets = tileIds.map((id) => tilesById[id].offset);
    const centroid = round(calculateCentroid(startingOffsets));

    if (arrangeToLine) {
      const targetOffsets = calculateLinearTilePositions(
        add(centroid, [tileSize / 2, tileSize / 2]),
        tileIds.length,
        calculateSmallOffsetBBox(state.windowDimensions)
      );

      return {
        ...state,
        ...shuffleTiles(state, tileIds, targetOffsets),
        showingArrangeToLine: false,
      };
    } else {
      const totalCircumferencePx = tileIds.length * tileSize * 1.5;
      const radiusPx = totalCircumferencePx / Math.PI / 2;
      const topLeft: PointOffset = [
        centroid[0] - radiusPx,
        centroid[1] - radiusPx,
      ];

      // Clamp the locations to fit inside the window if possible
      const offsetBBox = calculateSmallOffsetBBox(state.windowDimensions);
      const adjustedTopLeft = clampShapeTopLeft(
        topLeft,
        [radiusPx * 2 + tileSize, radiusPx * 2 + tileSize],
        offsetBBox
      );
      const adjustedCentroid = round(
        add(centroid, subtract(adjustedTopLeft, topLeft))
      );
      console.log({ centroid, topLeft, adjustedTopLeft, adjustedCentroid });

      const theta = (Math.PI * 2) / tileIds.length;
      const targetOffsets = range(tileIds.length).map((idx) => {
        const angle = theta * idx;
        return round(
          clampShapeTopLeft(
            add(adjustedCentroid, [
              Math.cos(angle) * radiusPx,
              Math.sin(angle) * radiusPx,
            ]),
            [tileSize, tileSize],
            offsetBBox
          )
        );
      });

      return {
        ...state,
        ...shuffleTiles(state, tileIds, shuffle(targetOffsets)),
        showingArrangeToLine: true,
      };
    }
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
      showingArrangeToLine: false,
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
      showingArrangeToLine: false,
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
      showingArrangeToLine: false,
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
  let newState = innerReducer(state, action);

  if (state.tiles !== newState.tiles) {
    updateURL(newState.tiles);
  }

  if (newState.showingArrangeToLine && !isEqual(state.selectedTileIds, newState.selectedTileIds)) {
    newState = { ...newState, showingArrangeToLine: false };
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
