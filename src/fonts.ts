export const MAIN_FONT = 'Poiret One';
export const MENU_DECODE_FONT = 'BJ Cree';

/**
 * Non-Latin fallback faces. The bundled Poiret One / BJ Cree fonts only carry
 * Latin glyphs, so localized text (Cyrillic, Japanese, Simplified Chinese) is
 * rendered by whichever of these the player's OS provides. Latin text is
 * unaffected because the display face is listed first.
 */
const I18N_FALLBACK_FONTS =
  '"Noto Sans", "Noto Sans CJK SC", "Noto Sans CJK JP", "Microsoft YaHei", "PingFang SC", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", "Segoe UI", sans-serif';

export const MAIN_CANVAS_FONT = `"${MAIN_FONT}", ${I18N_FALLBACK_FONTS}`;
export const MENU_CANVAS_FONT = `"${MENU_DECODE_FONT}", "${MAIN_FONT}", ${I18N_FALLBACK_FONTS}`;

const POIRET_ONE_URL = new URL('../ASSETS/fonts/Poiret_One/PoiretOne-Regular.ttf', import.meta.url).href;
const BJ_CREE_URL = new URL('../ASSETS/fonts/BJ_Cree/BJCree-Bold.ttf', import.meta.url).href;

export async function loadGameFonts(): Promise<void> {
  if (!('fonts' in document)) return;
  const faces = [
    new FontFace(MAIN_FONT, `url("${POIRET_ONE_URL}")`),
    new FontFace(MENU_DECODE_FONT, `url("${BJ_CREE_URL}")`),
  ];
  for (const face of faces) {
    document.fonts.add(face);
    await face.load();
  }
}

export function gameFont(sizePx: number, bold: boolean = true): string {
  return `${bold ? 'bold ' : ''}${sizePx}px ${MAIN_CANVAS_FONT}`;
}

export function menuFont(sizePx: number, bold: boolean = true): string {
  return `${bold ? 'bold ' : ''}${sizePx}px ${MENU_CANVAS_FONT}`;
}

