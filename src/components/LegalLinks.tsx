import { legalMeta } from '../legal/legalMeta'
import { useI18n } from '../i18n'

/** Footer legal links (Privacy · Terms · Report abuse). Plain anchors so they
 * work from every placement; the app parses /privacy and /terms on load. */
export function LegalLinks() {
  const { tr } = useI18n()
  return (
    <nav className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[0.7rem] text-base-content/40">
      <a href="/privacy" className="hover:underline">
        {tr('Privacy')}
      </a>
      <span aria-hidden>·</span>
      <a href="/terms" className="hover:underline">
        {tr('Terms')}
      </a>
      <span aria-hidden>·</span>
      <a href={`mailto:${legalMeta.abuseEmail}`} className="hover:underline">
        {tr('Report abuse')}
      </a>
    </nav>
  )
}
