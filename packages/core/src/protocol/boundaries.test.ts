import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The dependency rule from docs/REWRITE_ARCHITECTURE.md, enforced rather than
 * documented. A layering convention that only lives in a document is a
 * convention that erodes: the previous structure was also meant to keep app
 * code out of core, and a hardcoded command switch got in anyway.
 *
 * Inner layers may not import outward, and neither inner layer may touch a
 * platform API — that is what keeps every rule in them unit testable in plain
 * Node, with no Durable Object, socket, clock or browser.
 */

const SRC = join(import.meta.dirname, '..')

type Layer = {
  readonly name: string
  readonly dir: string
  /** Relative-import prefixes this layer is allowed to reach for. */
  readonly mayImport: readonly string[]
}

const LAYERS: readonly Layer[] = [
  { name: 'protocol', dir: join(SRC, 'protocol'), mayImport: ['./'] },
  { name: 'domain', dir: join(SRC, 'domain'), mayImport: ['./', '../protocol/'] },
]

/** Platform APIs that would make a rule untestable without a runtime. */
const FORBIDDEN_GLOBALS = [
  'cloudflare:workers', 'DurableObject', 'WebSocketPair', 'caches.',
  'localStorage', 'sessionStorage', 'indexedDB', 'document.', 'window.',
  'fetch(', 'navigator.', 'RTCPeerConnection',
]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return entry.endsWith('.ts') && !entry.endsWith('.test.ts') ? [full] : []
  })
}

/** Comments explain *why* a layer avoids something; those explanations must
 *  not trip the check that enforces the avoidance. */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe.each(LAYERS.map(layer => [layer.name, layer] as const))('%s layer', (name, layer) => {
  const files = sourceFiles(layer.dir)

  it('has sources to check', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files.map(file => [file.split('/').pop()!, file]))(
    '%s imports only from its own layer or inward',
    (_file, path) => {
      const imports = [...readFileSync(path, 'utf8').matchAll(/from\s+'([^']+)'/g)].map(match => match[1])
      const violations = imports.filter(
        specifier => !layer.mayImport.some(allowed => specifier.startsWith(allowed))
      )
      expect(violations).toEqual([])
    }
  )

  it.each(files.map(file => [file.split('/').pop()!, file]))(
    '%s reaches for no platform API',
    (_file, path) => {
      const code = codeOnly(readFileSync(path, 'utf8'))
      expect(FORBIDDEN_GLOBALS.filter(api => code.includes(api))).toEqual([])
    }
  )

  it.each(files.map(file => [file.split('/').pop()!, file]))(
    '%s names no consuming application',
    (file, path) => {
      // Core describes capabilities, not customers. Reported by line, because
      // a whole-source diff tells you nothing about where.
      const offending = readFileSync(path, 'utf8')
        .split('\n')
        .map((text, index) => ({ line: index + 1, text }))
        .filter(entry => /heyhubs/i.test(entry.text))
        .map(entry => `${file}:${entry.line}: ${entry.text.trim()}`)
      expect(offending).toEqual([])
    }
  )

  it(`${name} is reachable through one barrel`, () => {
    // A layer with no single entry point leaks its internal file structure
    // into every consumer, and moving a file becomes a breaking change.
    expect(files.some(file => file.endsWith('index.ts'))).toBe(true)
  })
})
