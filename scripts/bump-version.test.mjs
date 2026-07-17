import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'

const script = new URL('./bump-version.mjs', import.meta.url).pathname

test('bumps patch semver in package.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bump-'))
  const file = join(dir, 'package.json')
  writeFileSync(file, JSON.stringify({ name: 'x', version: '1.2.3' }) + '\n')

  execFileSync('node', [script, 'patch', file], { stdio: 'pipe' })
  const pkg = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(pkg.version, '1.2.4')
})

test('bumps minor semver', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bump-'))
  const file = join(dir, 'package.json')
  writeFileSync(file, JSON.stringify({ name: 'x', version: '1.2.3' }) + '\n')

  execFileSync('node', [script, 'minor', file], { stdio: 'pipe' })
  const pkg = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(pkg.version, '1.3.0')
})

test('keeps multiple packages on the same next version (lockstep)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bump-'))
  const app = join(dir, 'app.json')
  const core = join(dir, 'core.json')
  // Divergent starting points — same shape as peerly 0.2.2 / core 0.2.1.
  writeFileSync(app, JSON.stringify({ name: 'peerly', version: '0.2.2' }) + '\n')
  writeFileSync(core, JSON.stringify({ name: '@peerly/core', version: '0.2.1' }) + '\n')

  execFileSync('node', [script, 'minor', core, app], { stdio: 'pipe' })

  assert.equal(JSON.parse(readFileSync(core, 'utf8')).version, '0.3.0')
  assert.equal(JSON.parse(readFileSync(app, 'utf8')).version, '0.3.0')
})

test('lockstep base is the highest current version', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bump-'))
  const a = join(dir, 'a.json')
  const b = join(dir, 'b.json')
  writeFileSync(a, JSON.stringify({ name: 'a', version: '0.2.1' }) + '\n')
  writeFileSync(b, JSON.stringify({ name: 'b', version: '0.2.2' }) + '\n')

  execFileSync('node', [script, 'patch', a, b], { stdio: 'pipe' })

  assert.equal(JSON.parse(readFileSync(a, 'utf8')).version, '0.2.3')
  assert.equal(JSON.parse(readFileSync(b, 'utf8')).version, '0.2.3')
})
