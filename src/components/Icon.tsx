import type { SVGProps } from 'react'

export type IconName =
  | 'alert-triangle'
  | 'archive'
  | 'arrow-down'
  | 'arrow-up'
  | 'broom'
  | 'check'
  | 'chevron-down'
  | 'download'
  | 'file'
  | 'file-text'
  | 'film'
  | 'folder'
  | 'gauge'
  | 'hash'
  | 'image'
  | 'log-out'
  | 'menu'
  | 'message-circle'
  | 'mic'
  | 'mic-off'
  | 'moon'
  | 'music'
  | 'paperclip'
  | 'pause'
  | 'pencil'
  | 'phone-off'
  | 'plus'
  | 'refresh'
  | 'screen-share'
  | 'search'
  | 'shield'
  | 'sun'
  | 'trash'
  | 'video'
  | 'video-off'
  | 'x'

type Props = Omit<SVGProps<SVGSVGElement>, 'children'> & {
  name: IconName
  size?: number
}

export function Icon({ name, size = 18, className = '', ...props }: Props) {
  const body = (() => {
    switch (name) {
      case 'alert-triangle':
        return <><path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14a2 2 0 0 0 1.7 3h16a2 2 0 0 0 1.7-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></>
      case 'archive':
        return <><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></>
      case 'arrow-down':
        return <><path d="M12 5v14"/><path d="m7 14 5 5 5-5"/></>
      case 'arrow-up':
        return <><path d="M12 19V5"/><path d="m7 10 5-5 5 5"/></>
      case 'broom':
        return <><path d="m15 4 5 5"/><path d="M13.5 5.5 5 14l5 5 8.5-8.5"/><path d="M5 14 3 20l7-1"/></>
      case 'check':
        return <path d="m5 12 4 4L19 6"/>
      case 'chevron-down':
        return <path d="m6 9 6 6 6-6"/>
      case 'download':
        return <><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></>
      case 'file':
        return <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></>
      case 'file-text':
        return <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h8M8 9h2"/></>
      case 'film':
        return <><rect x="2" y="3" width="20" height="18" rx="2"/><path d="M7 3v18M17 3v18M2 8h5M17 8h5M2 16h5M17 16h5"/></>
      case 'folder':
        return <path d="M3 5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>
      case 'gauge':
        return <><path d="M4.9 19a9 9 0 1 1 14.2 0"/><path d="m12 13 4-4"/><path d="M12 19h.01"/></>
      case 'hash':
        return <><path d="M10 3 8 21M16 3l-2 18M4 9h16M3 15h16"/></>
      case 'image':
        return <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></>
      case 'log-out':
        return <><path d="M10 17l5-5-5-5M15 12H3"/><path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5"/></>
      case 'menu':
        return <><path d="M4 6h16M4 12h16M4 18h16"/></>
      case 'message-circle':
        return <path d="M21 15a4 4 0 0 1-4 4H8l-5 3 1.7-5A8 8 0 1 1 21 15Z"/>
      case 'mic':
        return <><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8"/></>
      case 'mic-off':
        return <><path d="m3 3 18 18M9 9v2a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.9-.7M5 10a7 7 0 0 0 11.9 5M19 10a7 7 0 0 1-.4 2.3M12 17v5M8 22h8"/></>
      case 'moon':
        return <path d="M20.6 14.4A8 8 0 0 1 9.6 3.4 9 9 0 1 0 20.6 14.4Z"/>
      case 'music':
        return <><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></>
      case 'paperclip':
        return <path d="m21.4 11.6-8.9 8.9a6 6 0 0 1-8.5-8.5l9.6-9.6a4 4 0 0 1 5.7 5.7l-9.6 9.6a2 2 0 0 1-2.8-2.8l8.9-8.9"/>
      case 'pause':
        return <><path d="M8 5v14M16 5v14"/></>
      case 'pencil':
        return <><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></>
      case 'phone-off':
        return <><path d="m3 3 18 18M8.5 8.5c-1 1.1-.7 2.3.2 3.8a15 15 0 0 0 3 3M14.5 15.5l2-2a2 2 0 0 1 2.4-.3l2.2 1.3a2 2 0 0 1 .9 2.3l-.5 2.1a3 3 0 0 1-3 2.3C9.6 20.2 3.8 14.4 2.8 5.5a3 3 0 0 1 2.3-3l2.1-.5a2 2 0 0 1 2.3.9l1.3 2.2"/></>
      case 'plus':
        return <><path d="M12 5v14M5 12h14"/></>
      case 'refresh':
        return <><path d="M20 7h-5V2"/><path d="M20 7a9 9 0 1 0 1 8"/></>
      case 'screen-share':
        return <><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4M8 10l4-4 4 4M12 6v7"/></>
      case 'search':
        return <><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></>
      case 'shield':
        return <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></>
      case 'sun':
        return <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>
      case 'trash':
        return <><path d="M3 6h18"/><path d="M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v6M14 11v6"/></>
      case 'video':
        return <><rect x="2" y="6" width="14" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/></>
      case 'video-off':
        return <><path d="m2 2 20 20M10.7 6H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12V11.3M16 10l5-3v10l-3-1.8"/></>
      case 'x':
        return <><path d="M18 6 6 18M6 6l12 12"/></>
    }
  })()

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
      {...props}
    >
      {body}
    </svg>
  )
}
