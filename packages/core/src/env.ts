/**
 * Build-time environment, injected by the host app. A library cannot read
 * `import.meta.env` on the app's behalf — Vite statically replaces those
 * expressions per-bundle — so every function that used to consult it takes
 * this record instead. Apps pass `import.meta.env` (or any plain object).
 */
export type Env = Record<string, string | undefined>
