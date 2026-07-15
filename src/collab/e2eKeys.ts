import { utf8ToBase64Url, bytesToBase64Url } from '../utils/base64url'
import type { JwkWithKid } from './oidcIdToken'
import { E2E_GOOGLE_CLIENT_ID } from './e2eConstants'

/**
 * Key material for the E2E fake identity provider. NEVER import this module
 * statically — only through the guarded dynamic import in e2eAuth.ts.
 *
 * It holds a real RSA private key that can mint tokens this app will accept as
 * genuine Google tokens whenever the E2E bypass is on. It is a test fixture and
 * is public in git, so it is only safe as long as it cannot reach a production
 * bundle. The guard in e2eAuth.ts is an inline `import.meta.env` comparison
 * precisely so the bundler folds it to a constant and drops this whole chunk;
 * a cross-module function call there would be opaque to tree-shaking and this
 * key would ship. `npm run guard:bundle` fails the build if it ever does.
 *
 * The keypair is fixed rather than generated because both peers in an E2E run
 * are separate browser contexts that must agree on the same issuer key.
 */
const E2E_GOOGLE_PUBLIC_JWK: JwkWithKid = {
  key_ops: ['verify'],
  ext: true,
  alg: 'RS256',
  kty: 'RSA',
  n: 'zrpA9xwzeaU2ZndxJNk7I3wH8scLSOW5UVgYqEl478G1MyGLsk0A6aQtZrJVky1uwbocZEDeYcRA48YM1W6wv8WOucjkd05yWse2uB2Tf2cm5zn2xtxGxvPsVm8LVS63br_jaV_ai6a6zfZhD46wBjmHVJ0DpGqWM3Py7jmoDcik2w8ZA1E79KqtYYkEYr9Uf4kVzn_en_4_AGoLBOFieS_4XjQ8gU4MM5IAxGv-IgVyJJaW4qX_F8mzRVf0iXRH1V6aO_UlsKKJYoJfFnyJ9TVkqYjCPFBGZlqpza_IVqIsfbo06HvZIkAC-3lQ0JFxr0vmCuxO8zbcNGP4QVVKWw',
  e: 'AQAB',
  kid: 'e2e-google',
}

const E2E_GOOGLE_PRIVATE_JWK: JsonWebKey = {
  key_ops: ['sign'],
  ext: true,
  alg: 'RS256',
  kty: 'RSA',
  n: E2E_GOOGLE_PUBLIC_JWK.n,
  e: 'AQAB',
  d: 'NqIymRvy3qsy_VGDrWFbp70XvKmt6c4Mc9r8aT1BoNtor-KlsLF5FEY3WXS3-PWA1-H_rt8V5nCfVZL5wU5Hl-b2GVNmTcGFp0gwmef3Gyx_s4w2E8gTTHEafJ1MOW7nO3Wq_CZA87dUlyoN7Lag_oQlp873L3SbzW1PPnYuW7W5V1eKNtK4xBEb8n0X4RdgWyhAMb_pw0YvsrAJ5PeFrV7rb9Q3kNN-gNOMl8-GARzpsFkPTr8AmXIHOyDCMcFJnKP-gxRw-tvraZ0fwA8q-ube7eBIsv-EdbIST9udBpSgNGlRh_HGzkjmwY-Ii1tqdgZ8mwKu7J1MCfwBoXkigQ',
  p: '8p03H2OFkL4sVSwxfbQ_3LWa7QO1f9uJPD4k0sXwEDRny_i9M6EePEEvdc81CLRbdU0CzKSZ7q5v177gIxzxJU7mpwJOT3hfNDKd48gQ97WbJRZ0fKWYI-BUm345YG7BU6Kz5NPkLWLFwp8yrYKypAAmKv9hgO64As4tVAvNlYk',
  q: '2iIpTfT6JSQjS71O2_aFH03h7js9Xtaq4vAnPG2_JX_0YpIqqFA81EINNUyJaFpY1I-k0oW6fCA8pBxIy9RHm6N5UotQsc-LQEtRPylOrLRmqqJYKlgL3DWFSYXEflcBBxLuk3YYdTx3dQ-tt1zydt8FxAJyp3rqFmyZFf9zi8M',
  dp: 'qI6JqYkfVryJWHNnvwnoBJM3m8uj4bzIz83tD3LtopSGOLQL3z7lHr-7FYJsOiv0Dr7-XudM-wK-OYondr243E7A-O8lMRlUK5OvFn39K9xEebPsIl16IhLNNWqwukq4jj7P9P8x3EZvVxP7xYi0TDS-T8k2GLnBplFQNMAuiOE',
  dq: 'ISaf8GESwyJC2vfiTDui76b-dx45rXgicGrfC6gCLMjNc02TfhDzra58I2WGXH2ekm9iNTxtov-jN620woV4fIbToV_a26sXFqZbqqW0dzrTf4s8qvLGmqjnoMzbl_fRCCowZ-jCvs55uSiw1fUiRD6QucFFe36KpO3MNjOkc9E',
  qi: 'wwudhZnm-j5kAnEN6qHlNHPC-xuZgG6u_t5IqH7-hN5egmOY_knr97wik8w0wU0DTGZ-ZTsHGDqCrGUqeST-xJlQotFeaa81ebQCj-hagl8ODAbpJYXMe4nKu0rlL-ElPRjRobSbHfXVyG6u8FuXywJrXAed-8shAfv5ZCnzaJ0',
}

let googlePrivateKey: CryptoKey | null = null

export function e2eJwks(): { keys: JwkWithKid[] } {
  return { keys: [E2E_GOOGLE_PUBLIC_JWK] }
}

async function privateKey(): Promise<CryptoKey> {
  if (!googlePrivateKey) {
    googlePrivateKey = await crypto.subtle.importKey(
      'jwk',
      E2E_GOOGLE_PRIVATE_JWK,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    )
  }
  return googlePrivateKey
}

export async function mintE2eToken(
  email: string,
  nonce: string,
  overrides: Record<string, unknown> = {}
): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT', kid: 'e2e-google' }
  const nowSec = Math.floor(Date.now() / 1000)
  const claims = {
    iss: 'https://accounts.google.com',
    aud: E2E_GOOGLE_CLIENT_ID,
    sub: email,
    email,
    // Mirror a real Google token: the app requires a verified email, so the
    // fake issuer must assert it too or E2E would not exercise the real path.
    email_verified: true,
    nonce,
    iat: nowSec,
    exp: nowSec + 3600,
    ...overrides,
  }
  const signingInput = `${utf8ToBase64Url(JSON.stringify(header))}.${utf8ToBase64Url(JSON.stringify(claims))}`
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    await privateKey(),
    new TextEncoder().encode(signingInput) as BufferSource
  )
  return `${signingInput}.${bytesToBase64Url(new Uint8Array(signature))}`
}
