import { Dimensions, Tile, TileId } from "./types";
import styled from "@emotion/styled";
import { motion } from "framer-motion";
import { tileFontSize, tileSizeRatio } from "./config";
import usePreviousValue from "./usePreviousValue";
import { useEffect, useState } from "react";

export const TileSprite = styled.div`
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
  appearingTileIds,
  tiles,
  windowDimensions,
}: {
  animating: boolean;
  selectedTileIds: Array<TileId>;
  appearingTileIds: Array<TileId>;
  tiles: Array<Tile>;
  windowDimensions: Dimensions;
}) {
  return (
    <>
      {tiles.map((tile) => {
        const left = tile.offset[0] + windowDimensions[0] / 2;
        const top = tile.offset[1] + windowDimensions[1] / 2;

        const selectedStyle = selectedTileIds.includes(tile.id)
          ? {
              outline: "3px solid white",
              boxShadow: "0px 4px 2px rgba(0, 0, 0, 0.4)",
            }
          : {};

        const opacityStyle = tile.ghost ? { opacity: 0.5 } : {};

        return (
          <AnimatedTileSprite
            key={tile.id}
            initial={{ x: 0, left, top }}
            animate={{
              x: appearingTileIds.includes(tile.id) ? [0, -1.5, 1.5, 0] : 0,
              left,
              top,
              transition: appearingTileIds.includes(tile.id)
                ? {
                    duration: 0.15,
                    bounce: 0,
                  }
                : animating
                ? undefined // default spring
                : { type: false },
            }}
            style={{ ...selectedStyle, ...opacityStyle }}
          >
            {tile.char}
          </AnimatedTileSprite>
        );
      })}
    </>
  );
}
