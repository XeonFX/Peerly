// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n'
import { AccountPreferencesPage } from './AccountPreferencesPage'

describe('AccountPreferencesPage', () => {
  beforeEach(() => localStorage.clear())

  it('owns app-wide theme and language preferences', () => {
    render(<I18nProvider><AccountPreferencesPage email="alice@example.com" onSignOut={() => {}} /></I18nProvider>)
    expect(screen.getByTestId('theme-toggle')).toBeTruthy()
    fireEvent.change(screen.getByTestId('locale-select'), { target: { value: 'pl' } })
    expect(screen.getByRole('heading', { name: 'Profil i preferencje' })).toBeTruthy()
  })
})
