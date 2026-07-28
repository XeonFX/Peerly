import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

/**
 * The inverse of `guard:bundle`, for the E2E build only.
 *
 * `guard:bundle` asserts a deployable bundle contains no test key material,
 * and it must stay unconditional — a single environment variable is not
 * something a "you cannot ship this" check should ever accept as permission.
 * So the E2E build does not run it at all; it runs this instead.
 *
 * This exists because the opposite failure is silent and expensive: a build
 * where tree-shaking dropped the fixtures signs in with no key and fails much
 * later as an unexplained bad signature, with nothing pointing at the cause.
 *
 * Whatever this passes is still not deployable. Its output carries a real RSA
 * private key that mints tokens the app trusts.
 */
const DIST = process.argv[2] ?? 'dist'

const REQUIRED = [
  { label: 'E2E RSA private exponent (d)', needle: 'NqIymRvy3qsy_VGDrWFbp70XvKmt6c4Mc9r8aT1BoNtor' },
  { label: 'E2E issuer public modulus (n)', needle: 'zrpA9xwzeaU2ZndxJNk7I3wH8scLSOW5UVgYqEl478G1MyGLsk0A6aQtZrJVky1uwbocZEDeYcRA48YM1W6wv8WOucjkd05yWse2uB' },
]

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else out.push(path)
  }
  return out
}

if (process.env.VITE_E2E_AUTH_BYPASS !== 'true') {
  console.error('check:e2e-fixtures — only meaningful for a VITE_E2E_AUTH_BYPASS=true build.')
  process.exit(2)
}

let files
try {
  files = walk(DIST)
} catch {
  console.error(`check:e2e-fixtures — no ${DIST}/ directory.`)
  process.exit(1)
}

const contents = files.map(file => readFileSync(file, 'utf8'))
const missing = REQUIRED.filter(({ needle }) => !contents.some(text => text.includes(needle)))

if (missing.length > 0) {
  console.error('check:e2e-fixtures FAILED — the E2E auth fixtures are not in this build:\n')
  for (const { label } of missing) console.error(`  - ${label}`)
  console.error(
    '\nSign-in would fail with an unexplained bad signature. Something folded the\n' +
      'guarded dynamic import in src/collab/e2eAuth.ts to false.'
  )
  process.exit(1)
}

console.log(
  `check:e2e-fixtures OK — fixtures present across ${files.length} files.\n` +
    'DO NOT DEPLOY this output: it contains a private key that mints trusted tokens.'
)
