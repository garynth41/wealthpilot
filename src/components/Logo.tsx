// Cresari mark (0.29.2, from Gary's artwork): three navy bars with slanted tops rising under a gold arrow, on a white tile.
// Same paths as public/favicon.svg, the public pages and scripts/native-assets.mjs (which draws every app icon) — change them together.
export function Logo({ size = 22, tile = false }: { size?: number; tile?: boolean }) {
  return <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" focusable="false">
    {tile && <rect width="64" height="64" rx="12" fill="#ffffff" />}
    <g fill="#002a50"><path d="M16.4 42.9 L24.4 38.9 V53.8 H16.4 Z" /><path d="M27.4 35.9 L35.8 31.7 V53.8 H27.4 Z" /><path d="M38.6 29 L47.4 24.5 V53.8 H38.6 Z" /></g>
    <path fill="#c39139" d="M16.4 40.2 L38.9 23.3 L33.4 17.6 L47.6 9.6 L47.4 21.9 Z" />
  </svg>
}
