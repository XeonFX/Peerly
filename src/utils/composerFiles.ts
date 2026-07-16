type ClipboardFiles = Pick<DataTransfer, 'files' | 'items'>

export function filesFromClipboard(clipboard: ClipboardFiles): File[] {
  const directFiles = Array.from(clipboard.files)
  if (directFiles.length > 0) return directFiles
  return Array.from(clipboard.items)
    .filter(item => item.kind === 'file')
    .map(item => item.getAsFile())
    .filter((file): file is File => file !== null)
}
