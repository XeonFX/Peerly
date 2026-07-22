export type DocumentLocaleMetadata = {
  lang: string
  title: string
  description?: string
}

/** Keep assistive-technology language and search/share metadata in sync. */
export function applyDocumentLocaleMetadata(metadata: DocumentLocaleMetadata): void {
  document.documentElement.lang = metadata.lang
  document.title = metadata.title
  if (metadata.description !== undefined) {
    let element = document.querySelector<HTMLMetaElement>('meta[name="description"]')
    if (!element) {
      element = document.createElement('meta')
      element.name = 'description'
      document.head.append(element)
    }
    element.content = metadata.description
  }
}
