import type { FileTransfer, SharedFile } from '../types'
import { formatBytes } from '../utils/format'

type Props = {
  files: SharedFile[]
  transfers: FileTransfer[]
}

function fileIcon(mime: string) {
  if (mime.startsWith('image/')) return '🖼️'
  if (mime.startsWith('video/')) return '🎬'
  if (mime.startsWith('audio/')) return '🎵'
  if (mime.includes('pdf')) return '📄'
  if (mime.includes('zip') || mime.includes('archive')) return '📦'
  return '📎'
}

export function FilesPanel({ files, transfers }: Props) {
  return (
    <aside className="files-panel w-64 shrink-0 overflow-y-auto border-l border-base-300/70 bg-base-200/75 p-4 backdrop-blur-xl max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-35 max-lg:w-[min(20rem,85vw)] max-lg:shadow-2xl">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-base-content/50">
        Shared files
      </h3>

      {transfers.length > 0 && (
        <div className="mb-4 space-y-2">
          {transfers.map(t => (
            <div key={`${t.id}-${t.direction}`} className="space-y-1">
              <span className="block truncate text-xs font-medium">{t.name}</span>
              <progress
                className="progress progress-primary h-1.5 w-full"
                value={t.percent * 100}
                max={100}
              />
              <span className="text-[0.65rem] text-base-content/50">
                {t.direction === 'send' ? 'Sending' : 'Receiving'} {Math.round(t.percent * 100)}%
              </span>
            </div>
          ))}
        </div>
      )}

      {files.length === 0 && transfers.length === 0 ? (
        <div className="space-y-2 text-sm text-base-content/50">
          <p>No files shared yet in this channel.</p>
          <p className="text-xs leading-relaxed">
            Click <strong className="text-base-content/70">Attach</strong> (📎) next to the message
            box to share a file with everyone here.
          </p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {files.map(file => (
            <li key={file.id}>
              <a
                href={file.url}
                download={file.name}
                className="flex items-center gap-2.5 rounded-lg border border-transparent px-2 py-2 transition-colors hover:border-base-300 hover:bg-base-300/60"
              >
                <span className="text-lg" aria-hidden="true">
                  {fileIcon(file.mimeType)}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-xs font-medium">{file.name}</span>
                  <span className="text-[0.65rem] text-base-content/50">
                    {formatBytes(file.size)}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}