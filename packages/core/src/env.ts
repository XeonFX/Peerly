/**
 * Build-time environment, injected by the host app. A library cannot read
 * `import.meta.env` on the app's behalf — Vite statically replaces those
 * expressions per-bundle — so every function that used to consult it takes
 * this record instead. Apps pass `import.meta.env` (or any plain object).
 */
export type Env = Record<string, string | undefined>

const APP_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

/**
 * Return the application partition configured by the host build.
 *
 * Shared networking code must never infer a product from room/channel names:
 * every host supplies its own stable id through `VITE_APP_ID`.
 */
export function requireAppId(env: Env): string {
  const appId = env.VITE_APP_ID?.trim()
  if (!appId || !APP_ID_PATTERN.test(appId)) {
    throw new Error(
      'VITE_APP_ID is required and must contain only lowercase letters, digits, and hyphens.'
    )
  }
  return appId
}
