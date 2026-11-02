// WealthPilot mark: a rising trend line that ends in a gold "pilot" arrowhead. Same glyph as public/favicon.svg (which adds the navy tile).
export function Logo({ size = 22 }: { size?: number }) {
  return <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" focusable="false">
    <path d="M11 47 L26 30 L34 38 L45 25" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M55 14 L50.5 30 L47 23 L39.5 20.5 Z" fill="#f2b632" />
  </svg>
}
