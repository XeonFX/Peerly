// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n'
import { AccountPreferencesPage } from './AccountPreferencesPage'
import { ClockFormatProvider } from '@peerly/core/react'

describe('AccountPreferencesPage', () => {
  beforeEach(() => localStorage.clear())

  it('owns app-wide theme and language preferences', () => {
    render(
      <ClockFormatProvider appId="peerly-test">
        <I18nProvider>
          <AccountPreferencesPage
            email="alice@example.com"
            profile={{ name: 'Alice', color: '#5865f2' }}
            onProfileChange={() => {}}
            onSignOut={() => {}}
          />
        </I18nProvider>
      </ClockFormatProvider>
    )
    expect(screen.getByTestId('theme-toggle')).toBeTruthy()
    fireEvent.change(screen.getByTestId('locale-select'), { target: { value: 'pl' } })
    expect(screen.getByRole('heading', { name: 'Profil i preferencje' })).toBeTruthy()
    expect((screen.getByTestId('clock-format-select') as HTMLSelectElement).value).toBe('24-hour')
    fireEvent.change(screen.getByTestId('clock-format-select'), { target: { value: '12-hour' } })
    expect((screen.getByTestId('clock-format-select') as HTMLSelectElement).value).toBe('12-hour')
    expect(localStorage.getItem('peerly-test-clock-format')).toBe('12-hour')
  })
})
