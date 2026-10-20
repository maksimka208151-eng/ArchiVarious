/**
 * ArchiVarious brand: the logo mark and the palette derived from it.
 * The mark was traced from the owner's logo (Figma source) on a 414 × 443 grid.
 */
export const LOGO_VIEWBOX = "0 0 414 443";
export const LOGO_PATH =
  "M0 16C0 6 7 0 16 0C23 0 29 5 30 11L64 191A162 156 0 0 0 386 193C388 184 394 179 401 179C408 179 414 185 414 192V413A30 30 0 0 1 384 443H30A30 30 0 0 1 0 413Z";

/** Brand colours. `ink` is the logo's navy; `sky` is its light counterpart for dark backgrounds. */
export const BRAND = {
  ink: "#113171",
  inkDeep: "#0a2152",
  sky: "#8aa6e6",
  mist: "#d9d9d9",
} as const;

/** The mark for Obsidian's `addIcon`: SVG content (no `<svg>` wrapper) on a 100 × 100 grid, in `currentColor`. */
export function obsidianLogoIcon(): string {
  const scale = 100 / 443;
  const dx = (100 - 414 * scale) / 2;
  return `<path fill="currentColor" transform="translate(${dx.toFixed(2)} 0) scale(${scale.toFixed(4)})" d="${LOGO_PATH}"/>`;
}
