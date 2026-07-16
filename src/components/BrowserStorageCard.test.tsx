// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n'
import { BrowserStorageCard, StoragePressureBanner } from './BrowserStorageCard'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('BrowserStorageCard', () => {
  it('renders quota pressure and refreshes the estimate', () => {
    const onRefresh = vi.fn()
    render(
      <I18nProvider>
        <BrowserStorageCard
          estimate={{
            supported: true,
            usageBytes: 900,
            quotaBytes: 1000,
            availableBytes: 100,
            usageRatio: 0.9,
            persisted: true,
            measuredAt: 1,
          }}
          pressure="warning"
          onRefresh={onRefresh}
          onRequestPersistence={async () => true}
          requestingPersistence={false}
        />
      </I18nProvider>
    )

    expect(screen.getByTestId('browser-storage-card').textContent).toContain('90% used')
    expect(screen.getByTestId('browser-storage-card').textContent).toContain('Local data protected')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh estimate' }))
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('localizes the critical storage banner in Polish', () => {
    localStorage.setItem('peerly-locale', 'pl')
    render(
      <I18nProvider>
        <StoragePressureBanner pressure="critical" availableBytes={1024} onManage={() => {}} />
      </I18nProvider>
    )
    expect(screen.getByTestId('storage-pressure-banner').textContent).toContain(
      'Pamięć przeglądarki jest prawie pełna'
    )
  })
})
