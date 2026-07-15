import { execSync } from 'child_process'
import { readFileSync } from 'fs'

/**
 * Build identity injected into the bundle as compile-time constants.
 *
 * Shared by vite.config.ts and vitest.config.ts on purpose: vitest does not read
 * vite.config.ts, so without this the app builds fine and every test that
 * imports config.ts dies on `__APP_VERSION__ is not defined`. Duplicating the
 * values in both configs would just let them drift instead.
 */
export function buildDefines() {
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
  return {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(resolveCommit()),
  }
}

/**
 * Short commit of the build, shown in the UI next to the version.
 *
 * Without it, "is the deployed app actually running my latest code?" can only be
 * answered by diffing bundles — the version alone doesn't move on every push.
 *
 * Hosts inject the SHA as an env var and often build from a shallow copy with no
 * git history, so prefer their variable and only shell out to git locally.
 * Never fail the build over this: a missing commit label is cosmetic.
 */
function resolveCommit() {
  const fromHost =
    process.env.CF_PAGES_COMMIT_SHA ??
    process.env.WORKERS_CI_COMMIT_SHA ??
    process.env.GITHUB_SHA ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.COMMIT_REF
  if (fromHost) return fromHost.slice(0, 7)

  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return 'unknown'
  }
}
