import { Dimensions, Tile, TileId } from "./types";
import styled from "@emotion/styled";
import { motion } from "framer-motion";
import { tileFontSize, tileSizeRatio } from "./config";
import usePreviousValue from "./usePreviousValue";
import { useEffect, useState } from "react";

const TileSprite = styled.div`
  position: absolute;
  align-items: center;
  background-color: #f3df96;
  border-radius: 0.2em;
  border: 1px solid #ac9337;
  box-shadow: 0px 2px 2px rgba(0, 0, 0, 0.4);
  color: #292000;
  display: inline-flex;
  flex-shrink: 0;
  font-size: ${tileFontSize}px;
  font-weight: 700;
  height: ${tileSizeRatio}em;
  justify-content: center;
  outline-radius: 0.2em;
  text-transform: uppercase;
  user-select: none;
  width: ${tileSizeRatio}em;
  cursor: grab;
`;

const AnimatedTileSprite = TileSprite.withComponent(motion.div);

export default function TileSprites({
  animating,
  selectedTileIds,
  tiles,
  windowDimensions,
}: {
  animating: boolean;
  selectedTileIds: Array<TileId>;
  tiles: Array<Tile>;
  windowDimensions: Dimensions;
}) {
  const wasAnimating = usePreviousValue(animating) ?? false;
  const previousTiles = usePreviousValue(tiles) ?? [];

  const [deferredTiles, setDeferredTiles] = useState<Array<Tile> | null>(null);

  // When we start animating, we need to do one render with the old tile
  // locations so that react-motion knows where each tile should start from.
  // This isn't an effect because we need to start using `deferredTiles`
  // immediately.
  if (!wasAnimating && animating && deferredTiles == null) {
    setDeferredTiles(previousTiles);
  }
  useEffect(() => {
    if (deferredTiles) setDeferredTiles(null);
  }, [deferredTiles]);

  return (
    <>
      {(deferredTiles ?? tiles).map((tile) => {
        const position = {
          left: tile.offset[0] + windowDimensions[0] / 2,
          top: tile.offset[1] + windowDimensions[1] / 2,
        };

        const selectedStyle = selectedTileIds.includes(tile.id)
          ? {
              outline: "3px solid white",
              boxShadow: "0px 4px 2px rgba(0, 0, 0, 0.4)",
            }
          : {};

        const opacityStyle = tile.ghost ? { opacity: 0.5 } : {};

        if (animating) {
          return (
            <AnimatedTileSprite
              key={tile.id}
              initial={position}
              animate={position}
              style={{ ...selectedStyle, ...opacityStyle }}
            >
              {tile.char}
            </AnimatedTileSprite>
          );
        } else {
          return (
            <TileSprite
              key={tile.id}
              style={{ ...selectedStyle, ...opacityStyle, ...position }}
            >
              {tile.char}
            </TileSprite>
          );
        }
      })}
    </>
  );
}
