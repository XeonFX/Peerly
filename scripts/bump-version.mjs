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

let lastVersion = null

for (const file of files) {
  const pkg = JSON.parse(readFileSync(file, 'utf8'))
  if (typeof pkg.version !== 'string') {
    throw new Error(`${file} has no string "version" field`)
  }
  const next = bumpSemver(pkg.version, bump)
  pkg.version = next
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`)
  console.log(`${file} → ${next}`)
  lastVersion = next
}

if (process.env.GITHUB_OUTPUT && lastVersion) {
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${lastVersion}\n`)
}