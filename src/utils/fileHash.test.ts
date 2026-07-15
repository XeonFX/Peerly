import { describe, expect, it } from 'vitest'
import { fileContentMatchesId, hashFileBytes } from './fileHash'

describe('hashFileBytes', () => {
  it('is deterministic and content-derived', async () => {
    const a = new TextEncoder().encode('hello world').buffer
    const b = new TextEncoder().encode('hello world').buffer
    const c = new TextEncoder().encode('hello world!').buffer

    expect(await hashFileBytes(a)).toBe(await hashFileBytes(b))
    expect(await hashFileBytes(a)).not.toBe(await hashFileBytes(c))
  })

  it('is 64 lowercase hex characters (SHA-256)', async () => {
    const hash = await hashFileBytes(new TextEncoder().encode('x').buffer)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('fileContentMatchesId — the actual poisoning defense', () => {
  it('accepts content whose hash matches the claimed id', async () => {
    const legitBytes = new TextEncoder().encode('quarterly-report.pdf contents').buffer
    const legitId = await hashFileBytes(legitBytes)

    expect(await fileContentMatchesId(legitBytes, legitId)).toBe(true)
  })

  it('rejects a peer serving different bytes under a legitimate id', async () => {
    // The scenario this exists for: a member shares a real file, its id becomes
    // public knowledge (it's in every peer's history), and a malicious peer
    // answers a later pull request for that id with malware or a swapped
    // document instead of the real bytes.
    const realBytes = new TextEncoder().encode('the real, trusted invoice').buffer
    const realId = await hashFileBytes(realBytes)

    const poisonedBytes = new TextEncoder().encode('malware payload pretending to be it').buffer

    expect(await fileContentMatchesId(poisonedBytes, realId)).toBe(false)
  })

  it('rejects a peer claiming to overwrite an existing file by id reuse', async () => {
    // Without content-addressing, any peer could re-announce an existing file's
    // id with new bytes to "edit" content everyone already has and trusts.
    // With it, reusing an id is only possible by reproducing its exact bytes.
    const original = new TextEncoder().encode('version 1').buffer
    const id = await hashFileBytes(original)
    const attemptedOverwrite = new TextEncoder().encode('version 2, attacker edited').buffer

    expect(await fileContentMatchesId(attemptedOverwrite, id)).toBe(false)
  })
})
