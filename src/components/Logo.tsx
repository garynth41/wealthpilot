// WealthPilot mark (Graphite, 0.17.0): a graphite tile, a white rising course line and a tangerine pilot's arrowhead. Same glyph as public/favicon.svg.
export function Logo({ size = 22, tile = false }: { size?: number; tile?: boolean }) {
  return <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" focusable="false">
    {tile && <rect width="64" height="64" rx="10" fill="#15181c" />}
    <path d="M12 46 L22 32 L30 39 L42 22" fill="none" stroke="var(--rail-active-ink, #ffffff)" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M54 11 L48 29 L44 22 L36 19.5 Z" fill="#f97316" />
    <circle cx="12" cy="46" r="3.4" fill="#f97316" />
  </svg>
}
