export const MAIN_FONT = 'Poiret One';
export const MENU_DECODE_FONT = 'BJ Cree';
export const MAIN_CANVAS_FONT = `"${MAIN_FONT}", sans-serif`;
export const MENU_CANVAS_FONT = `"${MENU_DECODE_FONT}", "${MAIN_FONT}", sans-serif`;

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

