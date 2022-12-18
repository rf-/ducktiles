import styled from "@emotion/styled";
import { AnimatePresence, motion } from "framer-motion";
import { Dispatch } from "react";
import { tileSizeRatio } from "./config";
import { Action } from "./reducer";
import { TileSprite } from "./TileSprites";

const isApple =
  [
    "iPad Simulator",
    "iPhone Simulator",
    "iPod Simulator",
    "iPad",
    "iPhone",
    "iPod",
  ].includes(navigator.platform) || navigator.userAgent.includes("Mac");

const modKey = isApple ? "⌘" : "Ctrl";

const Root = styled(motion.div)`
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  right: 0;
  background-color: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow-y: auto;
`;

const Container = styled.div`
  width: 20em;
  max-width: 100%;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.5em;
  font-size: min(24px, 4.5vw);
  padding: 1em 0;
`;

const Shortcut = styled.div`
  display: flex;
  gap: 0.5em;
  color: white;
  align-items: center;
`;

const Label = styled.div``;

const Spacer = styled.div`
  flex-grow: 1;
  height: 0.5em;
  align-self: flex-end;
  margin: 0 -2px 0.333em;
  background-repeat: repeat-x;
  background-position: bottom;
  background-size: 10px 1px;
  background-image: linear-gradient(
    to right,
    rgba(255, 255, 255, 0.8) 10%,
    rgba(0, 0, 0, 0) 0%
  );
`;

const Key = styled(TileSprite)`
  position: static;
  font-size: 1em;
  min-width: ${tileSizeRatio}em;
  width: auto;
  text-transform: none;
  padding: 0 0.2em;
  cursor: default;
`;

const KeyCombo = styled.div`
  display: flex;
  gap: 0.2em;
`;

const Or = styled.div`
  font-size: 0.6em;
  text-transform: uppercase;
  letter-spacing: 0.05em;
`;
Or.defaultProps = { children: "or" };

export default function HelpOverlay({
  visible,
  dispatch,
}: {
  visible: boolean;
  dispatch: Dispatch<Action>;
}) {
  return (
    <AnimatePresence>
      {visible && (
        <Root
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => dispatch({ type: "hideHelp" })}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.1 }}
        >
          <Container>
            <Shortcut>
              <Label>Add tiles</Label>
              <Spacer />
              <KeyCombo>
                <Key>Space</Key>
              </KeyCombo>
            </Shortcut>
            <Shortcut>
              <Label>Place tiles</Label>
              <Spacer />
              <KeyCombo>
                <Key>Enter</Key>
              </KeyCombo>
            </Shortcut>
            <Shortcut>
              <Label>Delete tiles</Label>
              <Spacer />
              <KeyCombo>
                <Key>Backspace</Key>
              </KeyCombo>
            </Shortcut>
            <Shortcut>
              <Label>Select all</Label>
              <Spacer />
              <KeyCombo>
                <Key>{modKey}</Key>
                <Key>A</Key>
              </KeyCombo>
            </Shortcut>
            <Shortcut>
              <Label>Shuffle</Label>
              <Spacer />
              <KeyCombo>
                <Key>{modKey}</Key>
                <Key>S</Key>
              </KeyCombo>
            </Shortcut>
            <Shortcut>
              <Label>Arrange as circle</Label>
              <Spacer />
              <KeyCombo>
                <Key>{modKey}</Key>
                <Key>⇧</Key>
                <Key>S</Key>
              </KeyCombo>
            </Shortcut>
            <Shortcut>
              <Label>Undo</Label>
              <Spacer />
              <KeyCombo>
                <Key>{modKey}</Key>
                <Key>Z</Key>
              </KeyCombo>
            </Shortcut>
            <Shortcut>
              <Label>Redo</Label>
              <Spacer />
              <KeyCombo>
                <Key>{modKey}</Key>
                <Key>Y</Key>
              </KeyCombo>
              <Or />
              <KeyCombo>
                <Key>{modKey}</Key>
                <Key>⇧</Key>
                <Key>Z</Key>
              </KeyCombo>
            </Shortcut>
            <Shortcut>
              <Label>Show help</Label>
              <Spacer />
              <KeyCombo>
                <Key>?</Key>
              </KeyCombo>
            </Shortcut>
          </Container>
        </Root>
      )}
    </AnimatePresence>
  );
}
