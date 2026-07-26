import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The dependency rule from docs/REWRITE_ARCHITECTURE.md, enforced rather than
 * documented. A layering convention that only lives in a document is a
 * convention that erodes: the previous structure was meant to keep app code
 * out of core too, and six comments and a hardcoded command switch got in
 * anyway.
 *
 * `protocol` is the innermost layer. It may import from itself and from
 * nothing else, and it may not touch a platform API that would stop it being
 * unit testable in plain Node.
 */

const PROTOCOL_DIR = join(import.meta.dirname, '.')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return entry.endsWith('.ts') && !entry.endsWith('.test.ts') ? [full] : []
  })
}

const files = sourceFiles(PROTOCOL_DIR)

/** Platform APIs that would make a rule untestable without a runtime. */
const FORBIDDEN_GLOBALS = [
  'cloudflare:workers', 'DurableObject', 'WebSocketPair', 'caches',
  'localStorage', 'sessionStorage', 'indexedDB', 'document', 'window',
  'fetch(', 'navigator', 'RTCPeerConnection',
]

describe('protocol layer boundaries', () => {
  it('finds the protocol sources', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files.map(file => [file.split('/').pop()!, file]))(
    '%s imports nothing outside the protocol layer',
    (_name, file) => {
      const source = readFileSync(file, 'utf8')
      const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map(match => match[1])
      const external = imports.filter(specifier => {
        if (specifier.startsWith('./')) return false
        // node: builtins are fine in tests, never in layer sources.
        return true
      })
      expect(external).toEqual([])
    }
  )

  it.each(files.map(file => [file.split('/').pop()!, file]))(
    '%s reaches for no platform API',
    (_name, file) => {
      const source = readFileSync(file, 'utf8')
      // Strip comments: the layer explains *why* it avoids these, and those
      // explanations must not trip the check that enforces the avoidance.
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      const found = FORBIDDEN_GLOBALS.filter(name => code.includes(name))
      expect(found).toEqual([])
    }
  )

  it.each(files.map(file => [file.split('/').pop()!, file]))(
    '%s names no consuming application',
    (name, file) => {
      // Core describes capabilities, not customers. Anything an app needs to
      // know belongs in that app's composition root. Reported per file and by
      // line, because a whole-source diff tells you nothing about where.
      const offending = readFileSync(file, 'utf8')
        .split('\n')
        .map((line, index) => ({ line: index + 1, text: line }))
        .filter(entry => /heyhubs/i.test(entry.text))
        .map(entry => `${name}:${entry.line}: ${entry.text.trim()}`)
      expect(offending).toEqual([])
    }
  )
})
