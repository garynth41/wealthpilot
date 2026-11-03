// WealthPilot mark (0.15.0): a rising teal course line on a navy tile, a compass ring behind it and a gold pilot's arrowhead at the top. Same glyph as public/favicon.svg.
export function Logo({ size = 22, tile = false }: { size?: number; tile?: boolean }) {
  return <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="wp-wave" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#2dd4bf" /><stop offset="1" stopColor="#7ef2e3" /></linearGradient>
      <linearGradient id="wp-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffd166" /><stop offset="1" stopColor="#f2a900" /></linearGradient>
    </defs>
    {tile && <rect width="64" height="64" rx="15" fill="#0b1a33" />}
    <circle cx="32" cy="33" r="22" fill="none" stroke="#2dd4bf" strokeOpacity=".45" strokeWidth="1.5" strokeDasharray="4 7" strokeLinecap="round" />
    <path d="M12 44 L21 31 L29 38 L41 22" fill="none" stroke="#061024" strokeOpacity=".5" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M12 44 L21 31 L29 38 L41 22" fill="none" stroke="url(#wp-wave)" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M53 12 L47.5 29.5 L43.5 22.5 L35.5 20 Z" fill="url(#wp-gold)" />
    <circle cx="12" cy="44" r="3.6" fill="#7ef2e3" />
  </svg>
}
