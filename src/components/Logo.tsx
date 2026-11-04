// WealthPilot mark (Ledger, 0.16.0): an ink tile with a gold hairline frame, a paper-coloured rising course line and a gold pilot's arrowhead. Same glyph as public/favicon.svg.
export function Logo({ size = 22, tile = false }: { size?: number; tile?: boolean }) {
  return <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" focusable="false">
    {tile && <rect width="64" height="64" rx="12" fill="#1b1813" />}
    <path d="M12 46 L22 32 L30 39 L42 22" fill="none" stroke="var(--rail-active-ink, #f4efe6)" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M54 11 L48 29 L44 22 L36 19.5 Z" fill="#c9a24a" />
    <circle cx="12" cy="46" r="3.4" fill="#c9a24a" />
  </svg>
}
