// Line icons in the spirit of SF Symbols (24×24, stroke = currentColor).
const PATHS = {
  clock: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 6.5V12l3.5 2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4.5" width="18" height="16.5" rx="3" />
      <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
    </>
  ),
  swap: <path d="M7 4 3.5 7.5 7 11M3.5 7.5H17M17 13l3.5 3.5L17 20M20.5 16.5H7" />,
  doc: (
    <>
      <path d="M14 2.5H7a2.5 2.5 0 0 0-2.5 2.5v14A2.5 2.5 0 0 0 7 21.5h10a2.5 2.5 0 0 0 2.5-2.5V8z" />
      <path d="M14 2.5V8h5.5M8.5 13h7M8.5 17h5" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8.5a6 6 0 0 0-12 0c0 7-3 8.5-3 8.5h18s-3-1.5-3-8.5" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="7.5" r="4" />
      <path d="M4 21v-1.5A4.5 4.5 0 0 1 8.5 15h7a4.5 4.5 0 0 1 4.5 4.5V21" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="7.5" r="3.5" />
      <path d="M2.5 20v-1a4 4 0 0 1 4-4h5a4 4 0 0 1 4 4v1M16 4.2a3.5 3.5 0 0 1 0 6.6M21.5 20v-1a4 4 0 0 0-3-3.85" />
    </>
  ),
  'chevron-right': <path d="m9 5 7 7-7 7" />,
  'chevron-left': <path d="m15 5-7 7 7 7" />,
  'chevron-updown': <path d="m8 9 4-4 4 4M8 15l4 4 4-4" />,
  plus: <path d="M12 5v14M5 12h14" />,
  pin: (
    <>
      <path d="M19.5 10c0 6-7.5 12-7.5 12S4.5 16 4.5 10a7.5 7.5 0 0 1 15 0z" />
      <circle cx="12" cy="10" r="2.75" />
    </>
  ),
  location: <path d="M21 3 3 10.5l7.5 3 3 7.5z" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  xmark: <path d="M6 6l12 12M18 6 6 18" />,
  cup: (
    <>
      <path d="M17 8.5h1.5a3.5 3.5 0 0 1 0 7H17" />
      <path d="M3 8.5h14V16a4.5 4.5 0 0 1-4.5 4.5h-5A4.5 4.5 0 0 1 3 16z" />
      <path d="M7 2.5v3M10.5 2.5v3M14 2.5v3" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 1.5v2M12 20.5v2M4.6 4.6 6 6M18 18l1.4 1.4M1.5 12h2M20.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
    </>
  ),
  download: <path d="M12 3.5v12M7 10.5l5 5 5-5M4 20.5h16" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="12.5" height="12.5" rx="2.5" />
      <path d="M5.5 15.5H5A2.5 2.5 0 0 1 2.5 13V5A2.5 2.5 0 0 1 5 2.5h8A2.5 2.5 0 0 1 15.5 5v.5" />
    </>
  ),
  send: <path d="M21.5 2.5 10.5 13.5M21.5 2.5l-7 19-4-8.5-8.5-4z" />,
  alert: (
    <>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9.5v4M12 17.25v.01" />
    </>
  ),
  building: (
    <>
      <path d="M3.5 21.5V9l8.5-6.5L20.5 9v12.5z" />
      <path d="M9.5 21.5v-6h5v6" />
    </>
  ),
  chart: (
    <>
      <path d="M3.5 20.5h17" />
      <path d="M6.5 20.5v-6M11 20.5V8M15.5 20.5v-9M20 20.5V4.5" />
    </>
  ),
  key: (
    <>
      <circle cx="7.5" cy="14.5" r="4" />
      <path d="M10.5 11.5 20 2M16.5 5.5l3 3M14 8l2.5 2.5" />
    </>
  ),
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  tag: (
    <>
      <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2.5 12.5v-10h10l8.1 8.1a2 2 0 0 1 0 2.8z" />
      <path d="M7.5 7.5h.01" />
    </>
  ),
  logout: <path d="M9.5 21H5.5A2.5 2.5 0 0 1 3 18.5v-13A2.5 2.5 0 0 1 5.5 3h4M16 17l5-5-5-5M21 12H9" />,
  share: <path d="M4.5 12.5v6A2.5 2.5 0 0 0 7 21h10a2.5 2.5 0 0 0 2.5-2.5v-6M16 6.5l-4-4-4 4M12 2.5v13" />,
  pencil: <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />,
  trash: <path d="M3.5 6h17M8.5 6V4a1.5 1.5 0 0 1 1.5-1.5h4A1.5 1.5 0 0 1 15.5 4v2M18.5 6l-1 14a2 2 0 0 1-2 1.5h-7a2 2 0 0 1-2-1.5l-1-14" />,
  hand: <path d="M18 11V6.5a1.5 1.5 0 0 0-3 0V11M15 10V4.5a1.5 1.5 0 0 0-3 0V10M12 10.5V5.5a1.5 1.5 0 0 0-3 0V14M18 8.5a1.5 1.5 0 0 1 3 0V14a8 8 0 0 1-8 8h-1.5a8 8 0 0 1-6.4-3.2L3 15.5a1.6 1.6 0 0 1 2.6-1.9L9 17" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 11v6M12 7.5v.01" />
    </>
  ),
  ellipsis: <path d="M5 12h.01M12 12h.01M19 12h.01" />,
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 22, stroke = 2, className = '' }: { name: IconName; size?: number; stroke?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  )
}
