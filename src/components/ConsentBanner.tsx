import { useI18n } from '../i18n'

type Props = {
  /** Persist acceptance and dismiss. */
  onAccept: () => void
}

/**
 * First-run agreement bar, shown until the current Terms + Privacy version is
 * accepted. Peerly uses only essential local storage and no trackers, so a
 * bottom banner (not a blocking wall) is the proportionate mechanism.
 */
export function ConsentBanner({ onAccept }: Props) {
  const { tr } = useI18n()

  return (
    <div className="fixed inset-x-0 bottom-0 z-[70] px-3 pb-3" role="dialog" aria-live="polite" data-testid="consent-banner">
      <div className="mx-auto flex max-w-3xl flex-col gap-3 rounded-box border border-base-300 bg-base-100 p-4 shadow-lg md:flex-row md:items-center md:justify-between">
        <p className="text-sm text-base-content/80">
          {tr('We use only essential local storage — no tracking, no ads. By using Peerly you accept our')}{' '}
          <a href="/terms" className="link link-primary">
            {tr('Terms')}
          </a>{' '}
          {tr('and')}{' '}
          <a href="/privacy" className="link link-primary">
            {tr('Privacy Policy')}
          </a>
          .
        </p>
        <button type="button" className="btn btn-primary btn-sm shrink-0" data-testid="consent-accept" onClick={onAccept}>
          {tr('Accept')}
        </button>
      </div>
    </div>
  )
}
