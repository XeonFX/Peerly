import { describe, expect, it } from 'vitest'
import { deviceGrantBytes, type DeviceGrant } from './deviceAuthorization'

/**
 * The mechanism is covered by core's own suite. What is app-owned — and what
 * this pins — is the scheme baked into the signing input. Change it and every
 * device pairing our users already hold stops verifying, silently: their
 * second device simply stops being trusted, with no error anywhere.
 *
 * So this is a golden vector, not a round-trip. A round-trip would agree with
 * itself no matter which scheme it was given.
 */

const body: Omit<DeviceGrant, 'sig'> = {
  v: 1,
  userId: 'user-alice',
  issuerDeviceKeyId: 'P-256:issuer-x:issuer-y' as DeviceGrant['issuerDeviceKeyId'],
  subjectDeviceKeyId: 'P-256:subject-x:subject-y' as DeviceGrant['subjectDeviceKeyId'],
  createdAt: 1_700_000_000_000,
  pairingId: 'pairing-id-1234567890',
}

describe('device grant signing input', () => {
  it('encodes the frozen scheme and field order', () => {
    expect(new TextDecoder().decode(deviceGrantBytes(body))).toBe(
      [
        'peerly-device-grant-v1',
        '1',
        'user-alice',
        'P-256:issuer-x:issuer-y',
        'P-256:subject-x:subject-y',
        '1700000000000',
        'pairing-id-1234567890',
      ].join('\n')
    )
  })
})
