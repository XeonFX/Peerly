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