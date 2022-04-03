import "normalize.css";
import "focus-visible";

import { css, Global } from "@emotion/react";
import styled from "@emotion/styled";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import Logo from "./Logo";
import TrashIcon from "./TrashIcon";
import { initializer, initialState, reducer } from "./reducer";
import { calculateBoundingBox } from "./geometry";
import TileSprites from "./TileSprites";
import {
  buttonFontSizePx,
  buttonFontSizeVW,
  defaultLineHeight,
  buttonsMarginBottomEm,
  buttonVerticalPaddingEm,
  footerMarginBottomEm,
  footerFontSizePx,
  footerFontSizeVW,
} from "./config";
import ZeroState from "./ZeroState";
import HelpIcon from "./HelpIcon";
import HelpOverlay from "./HelpOverlay";
import { PointerId } from "./types";
import UndoIcon from "./UndoIcon";
import RedoIcon from "./RedoIcon";
import union from "lodash/union";
import difference from "lodash/difference";

const globalStyles = css`
  * {
    box-sizing: border-box;
  }

  body {
    background-image: url("wood.jpg");
    font-family: "Lato", "Helvetica Neue", "Arial", "Helvetica", sans-serif;
    overflow: hidden;
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    right: 0;
  }

  body,
  body * {
    touch-action: none;
    user-select: none;
  }

  html.cursor-grabbing * {
    cursor: grabbing !important;
  }

  [data-js-focus-visible] :focus:not([data-focus-visible-added]) {
    outline: none !important;
  }
`;

const AppRoot = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
`;

const Footer = styled.div`
  align-items: center;
  bottom: 0;
  display: flex;
  flex-direction: column;
  pointer-events: none;
  position: fixed;
  width: 100%;
`;

const ButtonsContainer = styled.div`
  margin-bottom: ${buttonsMarginBottomEm}em;
  display: flex;
  gap: 1em;
  font-size: min(${buttonFontSizePx}px, ${buttonFontSizeVW}vw);
`;

const ZeroStateAnchor = styled.div`
  position: relative;
`;

const ZeroStateContainer = styled.div`
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%) translateY(-100%);
`;

const Button = styled.button`
  pointer-events: auto;
  border-radius: 0.3em;
  font-family: inherit;
  background-color: #ad0000;
  border: none;
  color: white;
  line-height: ${defaultLineHeight};
  text-transform: uppercase;
  letter-spacing: min(3px, 0.5vw);
  padding: ${buttonVerticalPaddingEm}em 1em;
  box-shadow: 0 4px 5px rgba(40, 0, 0, 0.2);
  cursor: pointer;
  font-weight: 700;

  &:hover:not(:disabled) {
    background-color: #c00000;
  }

  &:active:not(:disabled) {
    position: relative;
    top: 2px;
    box-shadow: 0 2px 3px rgba(40, 0, 0, 0.2);
  }

  &:disabled {
    cursor: default;
    opacity: 0.5;
    pointer-events: none;
  }

  &:focus-visible,
  [data-focus-visible-added] {
    outline: 3px solid white;
  }
`;

Button.defaultProps = {
  type: "button",
};

const HelpButton = styled.button`
  background-color: #ad0000;
  color: #ead5b7;
  width: 1.5em;
  height: 1.5em;
  border: none;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  cursor: pointer;
  filter: drop-shadow(0 1px 2px rgba(40, 0, 0, 0.2));
  margin: -0.25em 0;

  &:hover:not(:disabled) {
    background-color: #c00000;
  }

  &:active:not(:disabled) {
    position: relative;
    top: 1px;
    filter: drop-shadow(0 0 1px rgba(40, 0, 0, 0.2));
  }

  &:focus-visible,
  [data-focus-visible-added] {
    outline: 2px solid white;
  }
`;

HelpButton.defaultProps = {
  type: "button",
};

const FooterTextBar = styled.div`
  display: flex;
  font-size: min(${footerFontSizePx}px, ${footerFontSizeVW}vw);
  line-height: ${defaultLineHeight};
  margin-bottom: ${footerMarginBottomEm}em;
  gap: 0.5em;
  pointer-events: auto;
  white-space: nowrap;
  align-items: center;

  * {
    flex-shrink: 0;
  }
`;

const FooterTextBarInner = styled.div`
  display: flex;
  gap: 0.3em;
  white-space: nowrap;
  opacity: 0.6;
  align-items: center;

  a {
    color: #ad0000;
    font-weight: 700;
    text-decoration: none;
  }
`;

const SelectionBoxVisualization = styled.div`
  background-color: rgba(56, 195, 255, 0.3);
  border: 2px solid rgba(56, 195, 255, 0.6);
  pointer-events: none;
  position: absolute;
`;

const HiddenInput = styled.input`
  opacity: 0;
  position: absolute;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
`;

function stopPropagation(event: { stopPropagation(): void }) {
  event.stopPropagation();
}

function App() {
  const [
    {
      tiles,
      animatingTileMovement,
      inputLetters,
      inputPreview,
      windowDimensions,
      activeMoves,
      activeSelection,
      primaryPointerPosition,
      selectedTileIds,
      appearingTileIds,
      useTouchUI,
      undoStack,
      redoStack,
      showingZeroState,
      showingHelp,
    },
    dispatch,
  ] = useReducer(reducer, initialState, initializer);

  const addTilesInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Bind hotkeys at the top level in case nothing is focused
    function handleKeyDown(event: KeyboardEvent) {
      dispatch({ type: "keyDown", event });
    }

    // Try to prevent zoom gestures
    function handleTouchMove(event: TouchEvent) {
      if ("scale" in event && (event as any).scale !== 1)
        event.preventDefault();
    }

    // Keep track of the window's dimensions
    function handleWindowResize() {
      dispatch({
        type: "windowResize",
        dimensions: [window.innerWidth, window.innerHeight],
      });
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("touchmove", handleTouchMove);
    window.addEventListener("resize", handleWindowResize);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("resize", handleWindowResize);
    };
  }, []);

  const handlePointerDownCapture = useCallback(
    (event: React.PointerEvent) => {
      if (!useTouchUI && event.pointerType === "touch") {
        dispatch({ type: "enableTouchUI" });
      } else if (useTouchUI && event.pointerType === "mouse") {
        dispatch({ type: "disableTouchUI" });
      }
    },
    [useTouchUI]
  );

  const handlePointerDown = useCallback((event: React.PointerEvent) => {
    dispatch({
      type: "pointerDown",
      point: [event.clientX, event.clientY],
      pointerId: event.pointerId as PointerId,
      isPrimary: event.isPrimary,
      hasModifier: event.shiftKey || event.ctrlKey || event.metaKey,
    });
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent) => {
    dispatch({
      type: "pointerMove",
      point: [event.clientX, event.clientY],
      pointerId: event.pointerId as PointerId,
      isPrimary: event.isPrimary,
    });
  }, []);

  const handlePointerUp = useCallback((event: React.PointerEvent) => {
    dispatch({
      type: "pointerUp",
      point: [event.clientX, event.clientY],
      pointerId: event.pointerId as PointerId,
      isPrimary: event.isPrimary,
    });
  }, []);

  const handleAddButtonClick = useCallback(() => {
    if (useTouchUI) {
      const text = prompt("Enter some letters!");
      if (text) {
        dispatch({ type: "addTilesFromPrompt", text });
      }
    } else {
      dispatch({ type: "startAddTiles" });
    }
  }, [useTouchUI]);

  const handleAddTilesInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      dispatch({ type: "changeAddTilesInput", input: event.target.value });
    },
    []
  );

  const handleAddTilesInputBlur = useCallback(() => {
    addTilesInput.current?.focus();
  }, []);

  const handleShuffleButtonClick = useCallback(() => {
    dispatch({ type: "shuffle" });
  }, []);

  const handleUndoButtonClick = useCallback(() => {
    dispatch({ type: "undo" });
  }, []);

  const handleRedoButtonClick = useCallback(() => {
    dispatch({ type: "redo" });
  }, []);

  const handleTrashButtonClick = useCallback(() => {
    if (useTouchUI && selectedTileIds.length === 0) {
      const confirmed = window.confirm(
        "Are you sure you want to delete everything?"
      );
      if (!confirmed) return;
    }
    dispatch({ type: "delete" });
  }, [useTouchUI, selectedTileIds]);

  const handleHelpClick = useCallback(() => {
    dispatch({ type: "showHelp" });
  }, []);

  const isMoving = Object.keys(activeMoves).length > 0;
  useLayoutEffect(() => {
    if (isMoving) {
      document.documentElement.classList.add("cursor-grabbing");
    } else {
      document.documentElement.classList.remove("cursor-grabbing");
    }
  }, [isMoving]);

  const selectionBoxPosition = useMemo(() => {
    if (activeSelection == null) return null;

    const [minX, maxX, minY, maxY] = calculateBoundingBox(
      activeSelection.origin,
      primaryPointerPosition
    );
    return {
      left: minX,
      width: maxX - minX,
      top: minY,
      height: maxY - minY,
    };
  }, [activeSelection, primaryPointerPosition]);

  const allTiles = useMemo(() => {
    const movePreview = Object.assign(
      {},
      ...Object.values(activeMoves).map((move) => move.preview)
    );

    return [
      ...tiles.map((tile) => movePreview[tile.id] ?? tile),
      ...Object.values(inputPreview),
    ];
  }, [tiles, inputPreview, activeMoves]);

  const allSelectedTileIds = useMemo(
    () =>
      activeSelection?.deselecting
        ? difference(selectedTileIds, activeSelection.tileIds)
        : union(selectedTileIds, activeSelection?.tileIds ?? []),
    [selectedTileIds, activeSelection]
  );

  return (
    <AppRoot
      onPointerDownCapture={handlePointerDownCapture}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <Global styles={globalStyles} />
      <Logo />
      <TileSprites
        animatingTileMovement={animatingTileMovement}
        selectedTileIds={allSelectedTileIds}
        appearingTileIds={appearingTileIds}
        tiles={allTiles}
        windowDimensions={windowDimensions}
      />
      {selectionBoxPosition != null && (
        <SelectionBoxVisualization style={selectionBoxPosition} />
      )}
      {inputLetters != null && (
        <HiddenInput
          type="text"
          value=""
          onChange={handleAddTilesInputChange}
          onBlur={handleAddTilesInputBlur}
          ref={addTilesInput}
          autoFocus
        />
      )}
      <Footer>
        <ButtonsContainer>
          <ZeroStateAnchor>
            {showingZeroState && (
              <ZeroStateContainer>
                <ZeroState />
              </ZeroStateContainer>
            )}
            <Button
              onPointerDown={stopPropagation}
              onClick={handleAddButtonClick}
              disabled={inputLetters != null}
            >
              Add tiles
            </Button>
          </ZeroStateAnchor>
          <Button
            onPointerDown={stopPropagation}
            onClick={handleShuffleButtonClick}
            disabled={inputLetters != null || tiles.length === 0}
          >
            Shuffle
          </Button>
          {windowDimensions[0] > 600 && (
            <>
              <Button
                aria-label="Undo"
                onPointerDown={stopPropagation}
                onClick={handleUndoButtonClick}
                disabled={inputLetters != null || undoStack.length === 0}
              >
                <UndoIcon />
              </Button>
              <Button
                aria-label="Redo"
                onPointerDown={stopPropagation}
                onClick={handleRedoButtonClick}
                disabled={inputLetters != null || redoStack.length === 0}
              >
                <RedoIcon />
              </Button>
            </>
          )}
          <Button
            aria-label="Delete"
            onPointerDown={stopPropagation}
            onClick={handleTrashButtonClick}
            disabled={inputLetters != null || tiles.length === 0}
          >
            <TrashIcon />
          </Button>
        </ButtonsContainer>
        <FooterTextBar>
          <FooterTextBarInner>
            <span>
              Made by{" "}
              <a href="https://rynftz.gr" target="_blank" rel="noreferrer">
                Ryan Fitzgerald
              </a>
            </span>
            <span>&middot;</span>
            <a
              href="https://github.com/rf-/ducktiles"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
            <span>&middot;</span>
            <span>
              Logo by{" "}
              <a
                href="https://thenounproject.com/naripuru"
                target="_blank"
                rel="noreferrer"
              >
                parkjisun
              </a>
            </span>
            <span>&middot;</span>
          </FooterTextBarInner>
          <HelpButton
            aria-label="Help"
            onPointerDown={stopPropagation}
            onClick={handleHelpClick}
          >
            <HelpIcon />
          </HelpButton>
        </FooterTextBar>
      </Footer>
      <HelpOverlay visible={showingHelp} dispatch={dispatch} />
    </AppRoot>
  );
}

export default App;
