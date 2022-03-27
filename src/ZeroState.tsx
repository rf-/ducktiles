import styled from "@emotion/styled";
import { motion, Transition } from "framer-motion";
import DownArrow from "./DownArrow";

const Root = styled(motion.div)`
  display: flex;
  flex-direction: column;
  align-items: center;
  color: #ad0000;
  padding-bottom: 0.125em;
  font-size: min(36px, 8vw);
`;

const Text = styled.div`
  white-space: nowrap;
  font-family: "Dancing Script", "Didot", serif;
  text-shadow: 0 1px 2px rgba(40, 0, 0, 0.2);
`;

const ArrowContainer = styled.div`
  filter: drop-shadow(0 1px 2px rgba(40, 0, 0, 0.2));
`;

const bounceTransition: Transition = {
  y: {
    duration: 0.4,
    yoyo: Infinity,
    ease: "easeOut",
  },
};

export default function ZeroState() {
  return (
    <Root
      transition={bounceTransition}
      animate={{
        y: ["0%", "-15%"],
      }}
    >
      <Text>Start here!</Text>
      <ArrowContainer>
        <DownArrow />
      </ArrowContainer>
    </Root>
  );
}
