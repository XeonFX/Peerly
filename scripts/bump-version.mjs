#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from 'fs'

const usage = 'Usage: node scripts/bump-version.mjs <patch|minor|major> <package.json> [...]'

const [bump, ...files] = process.argv.slice(2)

if (!['patch', 'minor', 'major'].includes(bump) || files.length === 0) {
  console.error(usage)
  process.exit(1)
}

function bumpSemver(version, type) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!match) throw new Error(`Invalid semver: ${version}`)
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  if (type === 'major') return `${major + 1}.0.0`
  if (type === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

/** Compare a.b.c strings; positive if a > b. */
function cmpSemver(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i]
  }
  return 0
}

// Lockstep: base is the highest current version among the listed packages,
// then every file is written to the same next version. Independent per-file
// bumps left peerly at 0.2.2 and @peerly/core at 0.2.1.
const currents = files.map(file => {
  const pkg = JSON.parse(readFileSync(file, 'utf8'))
  if (typeof pkg.version !== 'string') {
    throw new Error(`${file} has no string "version" field`)
  }
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) {
    throw new Error(`${file} has invalid semver: ${pkg.version}`)
  }
  return { file, pkg, version: pkg.version }
})

const base = currents.reduce((max, c) => (cmpSemver(c.version, max) > 0 ? c.version : max), currents[0].version)
const next = bumpSemver(base, bump)

for (const { file, pkg, version } of currents) {
  pkg.version = next
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`)
  console.log(`${file}: ${version} → ${next}`)
}

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${next}\n`)
  appendFileSync(process.env.GITHUB_OUTPUT, `base=${base}\n`)
}
