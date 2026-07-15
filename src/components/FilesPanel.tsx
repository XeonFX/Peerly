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
    <aside className="files-panel">
      <h3>Shared files</h3>

      {transfers.length > 0 && (
        <div className="transfers">
          {transfers.map(t => (
            <div key={`${t.id}-${t.direction}`} className="transfer-item">
              <span className="transfer-name">{t.name}</span>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${t.percent * 100}%` }} />
              </div>
              <span className="transfer-label">
                {t.direction === 'send' ? 'Sending' : 'Receiving'} {Math.round(t.percent * 100)}%
              </span>
            </div>
          ))}
        </div>
      )}

      {files.length === 0 && transfers.length === 0 ? (
        <div className="files-empty">
          <p>No files shared yet in this channel.</p>
          <p className="files-hint">
            Click <strong>Attach</strong> (📎) next to the message box to share a file with everyone
            here.
          </p>
        </div>
      ) : (
        <ul className="files-list">
          {files.map(file => (
            <li key={file.id}>
              <a href={file.url} download={file.name} className="file-item">
                <span className="file-type-icon">{fileIcon(file.mimeType)}</span>
                <span className="file-details">
                  <span className="file-name">{file.name}</span>
                  <span className="file-size">{formatBytes(file.size)}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}