import { beforeEach, describe, expect, it } from 'vitest'
import { base64UrlToUtf8, utf8ToBase64Url, bytesToBase64Url } from '../utils/base64url'
import { resetJwksCache, verifyGoogleIdToken, type JwksFetcher, type JwkWithKid } from './googleIdToken'

const AUDIENCE = 'test-client-id.apps.googleusercontent.com'
const NONCE = 'device-key-hash-abc123'
const KID = 'fake-google-key-1'

/** A fake "Google" for tests: our own RSA keypair standing in for Google's. */
async function makeFakeIssuer() {
  const keyPair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  )) as CryptoKeyPair

  const publicJwk = (await crypto.subtle.exportKey('jwk', keyPair.publicKey)) as JwkWithKid
  publicJwk.kid = KID

  const fetchJwks: JwksFetcher = async () => ({ keys: [publicJwk] })

  const mint = async (claimOverrides: Record<string, unknown> = {}, headerOverrides: Record<string, unknown> = {}) => {
    const header = { alg: 'RS256', typ: 'JWT', kid: KID, ...headerOverrides }
    const nowSec = Math.floor(Date.now() / 1000)
    const claims = {
      iss: 'https://accounts.google.com',
      aud: AUDIENCE,
      sub: '1234567890',
      email: 'alice@example.com',
      email_verified: true,
      name: 'Alice',
      nonce: NONCE,
      iat: nowSec,
      exp: nowSec + 3600,
      ...claimOverrides,
    }
    const signingInput = `${utf8ToBase64Url(JSON.stringify(header))}.${utf8ToBase64Url(JSON.stringify(claims))}`
    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      keyPair.privateKey,
      new TextEncoder().encode(signingInput) as BufferSource
    )
    return `${signingInput}.${bytesToBase64Url(new Uint8Array(signature))}`
  }

  return { fetchJwks, mint, keyPair }
}

beforeEach(() => {
  resetJwksCache()
})

describe('verifyGoogleIdToken', () => {
  it('accepts a validly signed token matching audience and nonce', async () => {
    const { fetchJwks, mint } = await makeFakeIssuer()
    const token = await mint()

    const claims = await verifyGoogleIdToken(token, {
      expectedAudience: AUDIENCE,
      expectedNonce: NONCE,
      fetchJwks,
    })

    expect(claims.email).toBe('alice@example.com')
  })

  it('rejects a token whose payload was tampered with after signing', async () => {
    const { fetchJwks, mint } = await makeFakeIssuer()
    const token = await mint()
    const [h, p, s] = token.split('.')

    // Attacker changes the email but keeps the original signature.
    const originalClaims = JSON.parse(base64UrlToUtf8(p))
    const forgedPayload = utf8ToBase64Url(
      JSON.stringify({ ...originalClaims, email: 'attacker@evil.com' })
    )
    const forged = `${h}.${forgedPayload}.${s}`

    await expect(
      verifyGoogleIdToken(forged, { expectedAudience: AUDIENCE, expectedNonce: NONCE, fetchJwks })
    ).rejects.toThrow(/signature/i)
  })

  it('rejects a token signed by a different key than the one in the JWKS', async () => {
    const real = await makeFakeIssuer()
    const impostor = await makeFakeIssuer() // different RSA keypair, same kid by construction
    // Mint with the impostor's key, but serve the REAL issuer's public key —
    // simulates a peer presenting a token that was never actually signed by
    // the party whose public key this app trusts.
    const forged = await impostor.mint()

    await expect(
      verifyGoogleIdToken(forged, { expectedAudience: AUDIENCE, expectedNonce: NONCE, fetchJwks: real.fetchJwks })
    ).rejects.toThrow(/signature/i)
  })

  it('rejects an expired token', async () => {
    const { fetchJwks, mint } = await makeFakeIssuer()
    const nowSec = Math.floor(Date.now() / 1000)
    const token = await mint({ exp: nowSec - 60 })

    await expect(
      verifyGoogleIdToken(token, { expectedAudience: AUDIENCE, expectedNonce: NONCE, fetchJwks })
    ).rejects.toThrow(/expired/i)
  })

  it('rejects a token minted for a different app (wrong audience)', async () => {
    const { fetchJwks, mint } = await makeFakeIssuer()
    const token = await mint({ aud: 'some-other-app.apps.googleusercontent.com' })

    await expect(
      verifyGoogleIdToken(token, { expectedAudience: AUDIENCE, expectedNonce: NONCE, fetchJwks })
    ).rejects.toThrow(/audience/i)
  })

  it('rejects a token bound to a different device key (nonce mismatch) — the replay defense', async () => {
    const { fetchJwks, mint } = await makeFakeIssuer()
    // A real, validly-signed, non-expired token for the right app — but bound
    // to someone else's device key. This is exactly what a replayed token from
    // another peer in the mesh looks like.
    const token = await mint({ nonce: 'someone-elses-device-key-hash' })

    await expect(
      verifyGoogleIdToken(token, { expectedAudience: AUDIENCE, expectedNonce: NONCE, fetchJwks })
    ).rejects.toThrow(/nonce/i)
  })

  it('rejects an unexpected issuer', async () => {
    const { fetchJwks, mint } = await makeFakeIssuer()
    const token = await mint({ iss: 'https://not-google.example' })

    await expect(
      verifyGoogleIdToken(token, { expectedAudience: AUDIENCE, expectedNonce: NONCE, fetchJwks })
    ).rejects.toThrow(/issuer/i)
  })

  it('rejects a non-RS256 algorithm (alg-confusion defense)', async () => {
    const { fetchJwks, mint } = await makeFakeIssuer()
    const token = await mint({}, { alg: 'none' })

    await expect(
      verifyGoogleIdToken(token, { expectedAudience: AUDIENCE, expectedNonce: NONCE, fetchJwks })
    ).rejects.toThrow(/algorithm/i)
  })

  it('rejects a token whose kid is not in the JWKS', async () => {
    const { fetchJwks, mint } = await makeFakeIssuer()
    const token = await mint({}, { kid: 'unknown-key-id' })

    await expect(
      verifyGoogleIdToken(token, { expectedAudience: AUDIENCE, expectedNonce: NONCE, fetchJwks })
    ).rejects.toThrow(/kid/i)
  })
})
