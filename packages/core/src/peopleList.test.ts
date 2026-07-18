import { beforeAll, describe, expect, it } from 'vitest'
import { canonicalizePublicKey } from './deviceIdentity.js'
import {
  addPeopleEntry,
  createPeopleAttestation,
  decodeSharedPeopleList,
  effectiveSubjectUserIds,
  emptyPeopleList,
  encodeSharedPeopleList,
  isSubjectListed,
  peopleAttestationBytes,
  removePeopleEntry,
  verifyPeopleAttestation,
  verifySharedPeopleList,
  type PeopleAttestation,
} from './peopleList.js'

const SCHEME = 'test-people-v1'

let keyPair: CryptoKeyPair
let keyId: string
let otherKeyPair: CryptoKeyPair

async function generateKeys() {
  return (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
}

async function sign(pair: CryptoKeyPair, bytes: Uint8Array): Promise<string> {
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    pair.privateKey,
    bytes as BufferSource
  )
  return Buffer.from(sig).toString('base64url')
}

beforeAll(async () => {
  keyPair = await generateKeys()
  otherKeyPair = await generateKeys()
  keyId = await canonicalizePublicKey(keyPair.publicKey)
})

const signer = {
  publicKeyId: async () => keyId,
  sign: async (bytes: Uint8Array) => sign(keyPair, bytes),
}

describe('peopleList attestations', () => {
  it('creates and verifies a friend with optional email', async () => {
    const entry = await createPeopleAttestation(signer, SCHEME, {
      kind: 'friend',
      ownerUserId: 'me',
      subjectUserId: 'them',
      subjectName: 'Ada',
      subjectEmail: 'ada@example.com',
    })
    expect(entry.subjectEmail).toBe('ada@example.com')
    expect(await verifyPeopleAttestation(SCHEME, 'friend', entry)).toBe(true)
  })

  it('rejects tampered subjectUserId', async () => {
    const entry = await createPeopleAttestation(signer, SCHEME, {
      kind: 'block',
      ownerUserId: 'me',
      subjectUserId: 'bad',
      subjectName: 'Trouble',
      category: 'spam',
    })
    entry.subjectUserId = 'someone-else'
    expect(await verifyPeopleAttestation(SCHEME, 'block', entry)).toBe(false)
  })

  it('rejects a foreign signature', async () => {
    const entry = await createPeopleAttestation(signer, SCHEME, {
      kind: 'block',
      ownerUserId: 'me',
      subjectUserId: 'bad',
      subjectName: 'Trouble',
    })
    entry.sig = await sign(otherKeyPair, peopleAttestationBytes(SCHEME, entry))
    expect(await verifyPeopleAttestation(SCHEME, 'block', entry)).toBe(false)
  })
})

describe('peopleList set + share', () => {
  it('tracks own entries and effective subjects', async () => {
    const list = emptyPeopleList()
    const entry = await createPeopleAttestation(signer, SCHEME, {
      kind: 'friend',
      ownerUserId: 'me',
      subjectUserId: 'f1',
      subjectName: 'Friend',
    })
    addPeopleEntry(list, entry)
    expect(isSubjectListed(list, 'f1')).toBe(true)
    expect(effectiveSubjectUserIds(list).has('f1')).toBe(true)
    expect(removePeopleEntry(list, 'f1')).toBe(true)
    expect(isSubjectListed(list, 'f1')).toBe(false)
  })

  it('round-trips a shared list and verifies entries', async () => {
    const entry = await createPeopleAttestation(signer, SCHEME, {
      kind: 'block',
      ownerUserId: 'me',
      subjectUserId: 'bad',
      subjectName: 'Spam',
    })
    const code = encodeSharedPeopleList('block', 'My blocks', [entry])
    const shared = decodeSharedPeopleList(code)
    expect(shared?.label).toBe('My blocks')
    const sub = await verifySharedPeopleList(SCHEME, 'block', shared!, 'other-user')
    expect(sub?.entries).toHaveLength(1)
    expect(sub?.entries[0]?.subjectUserId).toBe('bad')
  })

  it('drops self-blocks on import', async () => {
    const entry = await createPeopleAttestation(signer, SCHEME, {
      kind: 'block',
      ownerUserId: 'curator',
      subjectUserId: 'me',
      subjectName: 'Self',
    })
    const shared = decodeSharedPeopleList(encodeSharedPeopleList('block', 'x', [entry]))!
    expect(await verifySharedPeopleList(SCHEME, 'block', shared, 'me')).toBeNull()
  })

  it('rejects shared list of the wrong kind', async () => {
    const entry: PeopleAttestation = await createPeopleAttestation(signer, SCHEME, {
      kind: 'friend',
      ownerUserId: 'me',
      subjectUserId: 'f1',
      subjectName: 'F',
    })
    const shared = decodeSharedPeopleList(encodeSharedPeopleList('friend', 'x', [entry]))!
    expect(await verifySharedPeopleList(SCHEME, 'block', shared, 'other')).toBeNull()
  })
})
