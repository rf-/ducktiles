export const tileFontSize = 36;

export const tileSizeRatio = 1.5;

export const tileSize = tileFontSize * tileSizeRatio;

export const tileGap = 8;

export const defaultLineHeight = 1.15;

export const buttonFontSizePx = 18;

export const buttonFontSizeVW = 4;

export const buttonVerticalPaddingEm = 0.7;

export const buttonsMarginBottomEm = 1;

export const footerFontSizePx = 12;

export const footerFontSizeVW = 3;

export const footerMarginBottomEm = 1;

export function calculateFooterHeight(windowWidth: number): number {
  const buttonFontSize = Math.min(
    buttonFontSizePx,
    (buttonFontSizeVW * windowWidth) / 100
  );
  const footerFontSize = Math.min(
    footerFontSizePx,
    (footerFontSizeVW * windowWidth) / 100
  );
  return (
    buttonFontSize * defaultLineHeight +
    buttonFontSize * buttonVerticalPaddingEm * 2 +
    buttonFontSize * buttonsMarginBottomEm +
    footerFontSize * defaultLineHeight +
    footerFontSize * footerMarginBottomEm +
    // Add an extra margin on top to leave some breathing room
    buttonFontSize * buttonsMarginBottomEm
  );
}
