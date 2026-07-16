import type { FileTransfer, SharedFile } from '../types'
import { formatBytes } from '../utils/format'
import { Icon, type IconName } from './Icon'

type Props = {
  files: SharedFile[]
  transfers: FileTransfer[]
  onRequestFile: (file: SharedFile) => Promise<void>
}

function fileIcon(mime: string): IconName {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'film'
  if (mime.startsWith('audio/')) return 'music'
  if (mime.includes('pdf')) return 'file-text'
  if (mime.includes('zip') || mime.includes('archive')) return 'archive'
  return 'file'
}

export function FilesPanel({ files, transfers, onRequestFile }: Props) {
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
        <div className="flex flex-col items-center px-2 py-10 text-center text-base-content/50">
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/15 bg-primary/8 text-primary shadow-sm">
            <Icon name="folder" size={23} />
          </span>
          <p className="text-sm font-medium text-base-content/75">No shared files yet</p>
          <p className="mt-1.5 text-xs leading-relaxed">
            Use the paperclip beside the message box to share the first file.
          </p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {files.map(file => (
            <li key={file.id}>
              {file.url ? (
                <a
                  href={file.url}
                  download={file.name}
                  className="flex w-full items-center gap-2.5 rounded-xl border border-transparent px-2 py-2 text-left transition hover:border-base-300 hover:bg-base-300/60"
                >
                  <Icon name={fileIcon(file.mimeType)} size={19} className="text-primary" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-xs font-medium">{file.name}</span>
                    <span className="text-[0.65rem] text-base-content/50">{formatBytes(file.size)} · cached</span>
                  </span>
                  <span className="ml-auto text-xs font-medium text-primary">Save</span>
                </a>
              ) : (
                <button
                  type="button"
                  onClick={() => void onRequestFile(file)}
                  className="flex w-full items-center gap-2.5 rounded-xl border border-transparent px-2 py-2 text-left transition hover:border-base-300 hover:bg-base-300/60"
                >
                <Icon name={fileIcon(file.mimeType)} size={19} className="text-primary" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-xs font-medium">{file.name}</span>
                  <span className="text-[0.65rem] text-base-content/50">
                    {formatBytes(file.size)} · on demand
                  </span>
                </span>
                <Icon name="download" size={16} className="ml-auto text-primary" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
