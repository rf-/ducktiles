import styled from "@emotion/styled";
import Duck from "./Duck";

const LogoContainer = styled.div`
  align-items: center;
  color: #ad0000;
  display: flex;
  font-size: min(90px, 15vw);
  justify-content: center;
  margin-top: 32px;
  pointer-events: none;
  user-select: none;
  width: 100%;
`;

const LogoText = styled.div`
  font-family: "Dancing Script", "Didot", serif;
  font-weight: 700;
  text-shadow: 0 1px 2px rgba(40, 0, 0, 0.2);
`;

const DuckContainer = styled.div`
  align-self: flex-end;
  display: inline-flex;
  filter: drop-shadow(0 1px 2px rgba(40, 0, 0, 0.2));
  height: 0.75em;
  width: 0.75em;
  margin-right: 0.05em;
  position: relative;
  top: 0.02em;
`;

export default function Logo() {
  return (
    <LogoContainer>
      <DuckContainer>
        <Duck />
      </DuckContainer>
      <LogoText>Ducktiles</LogoText>
    </LogoContainer>
  );
}
