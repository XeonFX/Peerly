// The GIS wrapper moved to @peerly/core (googleSignIn.ts); only the env lookup
// stays here — a library cannot read this app's import.meta.env.
export { renderGoogleSignInButton } from '@peerly/core'

export function getGoogleClientId(): string | undefined {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID || undefined
}
