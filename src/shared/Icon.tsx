import type { SVGProps } from 'react'

export type IconName =
  | 'target'
  | 'grip'
  | 'undo'
  | 'redo'
  | 'layers'
  | 'lock'
  | 'unlock'
  | 'eye'
  | 'eye-off'
  | 'help'
  | 'close'
  | 'chevron-down'
  | 'chevron-up'
  | 'size'
  | 'trash'
  | 'image'
  | 'compare'
  | 'magnet'
  | 'check'
  | 'copy'
  | 'diff'
  | 'download'
  | 'more'
  | 'wand'

const paths: Record<IconName, JSX.Element> = {
  target: (
    <>
      <circle cx="12" cy="12" r="7.2" />
      <path d="M12 2v3.4M12 18.6V22M2 12h3.4M18.6 12H22" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  grip: (
    <>
      {[5, 12, 19].map((y) =>
        [9, 15].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.15" fill="currentColor" stroke="none" />),
      )}
    </>
  ),
  undo: (
    <>
      <path d="M4 9h9.5a5.5 5.5 0 0 1 0 11H8" />
      <path d="M7.5 5.5 4 9l3.5 3.5" />
    </>
  ),
  redo: (
    <>
      <path d="M20 9h-9.5a5.5 5.5 0 0 0 0 11H16" />
      <path d="M16.5 5.5 20 9l-3.5 3.5" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3 3.5 7.6 12 12.2l8.5-4.6L12 3Z" />
      <path d="M3.5 12.4 12 17l8.5-4.6" />
      <path d="M3.5 16.9 12 21.5l8.5-4.6" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10" width="15" height="10.5" rx="2.4" />
      <path d="M8.2 10V7.6a3.8 3.8 0 0 1 7.6 0V10" />
    </>
  ),
  unlock: (
    <>
      <rect x="4.5" y="10" width="15" height="10.5" rx="2.4" />
      <path d="M8.2 10V7.6a3.8 3.8 0 0 1 7.2-1.7" />
    </>
  ),
  eye: (
    <>
      <path d="M2.2 12S5.6 5.8 12 5.8 21.8 12 21.8 12 18.4 18.2 12 18.2 2.2 12 2.2 12Z" />
      <circle cx="12" cy="12" r="2.9" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M4.2 4.2 19.8 19.8" />
      <path d="M9.6 6.3A9.8 9.8 0 0 1 12 5.8c6.4 0 9.8 6.2 9.8 6.2a17 17 0 0 1-2.7 3.5" />
      <path d="M6.4 8A17.6 17.6 0 0 0 2.2 12S5.6 18.2 12 18.2a9.6 9.6 0 0 0 3.6-.7" />
      <path d="M10.1 10.2a2.9 2.9 0 0 0 3.9 4" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.4 9.2a2.7 2.7 0 1 1 3.6 2.5c-.7.3-1 .9-1 1.6v.4" />
      <circle cx="12" cy="17.2" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  close: <path d="M6 6 18 18M18 6 6 18" />,
  'chevron-down': <path d="m6 9.5 6 6 6-6" />,
  'chevron-up': <path d="m6 14.5 6-6 6 6" />,
  size: (
    <>
      <rect x="3.5" y="3.5" width="10" height="10" rx="1.4" />
      <path d="M17 10.5h3.5V21H10v-3.5" />
      <path d="M7.2 12.8h4M7.2 12.8v-4" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 7h15" />
      <path d="M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7" />
      <path d="M6.8 7l.8 12a1.6 1.6 0 0 0 1.6 1.5h5.6a1.6 1.6 0 0 0 1.6-1.5l.8-12" />
      <path d="M10.4 11v6M13.6 11v6" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m4.5 17.5 4.6-4.4a1.6 1.6 0 0 1 2.2 0l5.6 5.4" />
      <path d="m13.4 14.6 1.7-1.6a1.6 1.6 0 0 1 2.2 0l2.2 2.1" />
    </>
  ),
  compare: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 3.6v16.8" />
      <path d="M12 3.6a8.4 8.4 0 0 1 0 16.8Z" fill="currentColor" stroke="none" />
    </>
  ),
  magnet: (
    <>
      <path d="M7 3.6v8.1a5 5 0 0 0 10 0V3.6" />
      <path d="M7 8.1h3.6M13.4 8.1H17" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 6.8" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2" />
      <path d="M15.5 8.5V5.6A2.1 2.1 0 0 0 13.4 3.5H5.6A2.1 2.1 0 0 0 3.5 5.6v7.8a2.1 2.1 0 0 0 2.1 2.1h2.9" />
    </>
  ),
  diff: (
    <>
      <rect x="3.5" y="3.5" width="12" height="12" rx="2" />
      <path d="M8.5 20.5h9a2 2 0 0 0 2-2v-9" />
      <path d="M6.3 9.5h6.4M9.5 6.3v6.4" />
    </>
  ),
  download: (
    <>
      <path d="M12 3.5v10.4" />
      <path d="m7.7 9.9 4.3 4.3 4.3-4.3" />
      <path d="M4.5 19.5h15" />
    </>
  ),
  more: (
    <>
      <circle cx="6" cy="12" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.35" fill="currentColor" stroke="none" />
    </>
  ),
  wand: (
    <>
      <path d="m4.6 19.4 9.2-9.2" />
      <path d="m11.9 8.9 3.2 3.2" />
      <path d="m16.2 3.4.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9Z" />
      <path d="m6.4 3.6.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4L4.5 5.5l1.4-.5Z" />
    </>
  ),
}

export function Icon({
  name,
  size = 15,
  ...rest
}: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {paths[name]}
    </svg>
  )
}
