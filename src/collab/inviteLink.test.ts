import { describe, expect, it } from 'vitest'
import { decodeInviteFromHash, encodeInviteLink, generateWorkspaceId, type WorkspaceInvite } from './inviteLink'

const E2E_INVITE_HASH =
  'invite=eyJ2IjoxLCJ3b3Jrc3BhY2VJZCI6ImUyZTAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAxIiwid29ya3NwYWNlTmFtZSI6InRlc3Qtd3MiLCJjcmVhdG9yS2V5SWQiOiJQLTI1Njo4UDRaMmxOZEp0NFlRMEpId1VsZjZWWWpMUEJhd2x6R1lFSWZPcDZpR1ZrOmV6NFJZeEEteGxPZERueDIyZTdXVnZzYUNpRDdqc0F4T1JobnZMbElOQm8iLCJhbGxvd0xpc3QiOnsiZW1haWxzIjpbImFsaWNlQGUyZS50ZXN0IiwiYm9iQGUyZS50ZXN0Il0sInNpZ25lZEF0IjoxNzAwMDAwMDAwMDAwLCJzaWduYXR1cmUiOiJOLWNSd0Zkbk1VU01PdnFPVDM1U3NacmFqZEpiZ3dTVlRIcG1JYWExOXFiRGpCa2lUUHpES1BJb0JzdzVHblhsZDgwbWlHdlRkMFVRejdmWFFDNXdxdyJ9fQ'

function sampleInvite(): WorkspaceInvite {
  return {
    v: 1,
    workspaceId: generateWorkspaceId(),
    workspaceName: 'Acme Team',
    creatorKeyId: 'P-256:abc:def',
    allowList: { emails: ['alice@example.com'], signedAt: Date.now(), signature: 'sig' },
  }
}

describe('generateWorkspaceId', () => {
  it('produces high-entropy, url/localStorage-safe lowercase hex', () => {
    const id = generateWorkspaceId()
    expect(id).toMatch(/^[0-9a-f]{32}$/)
  })

  it('never repeats in practice', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateWorkspaceId()))
    expect(ids.size).toBe(1000)
  })
})

describe('invite link', () => {
  it('round-trips through encode/decode', () => {
    const invite = sampleInvite()
    const link = encodeInviteLink(invite, 'https://flux.example')
    const hash = new URL(link).hash

    expect(decodeInviteFromHash(hash)).toEqual(invite)
  })

  it('puts the payload in the fragment, never the query string or path', () => {
    const link = encodeInviteLink(sampleInvite(), 'https://flux.example')
    const url = new URL(link)

    expect(url.search).toBe('')
    expect(url.pathname).toBe('/')
    expect(url.hash).toContain('invite=')
  })

  it('returns null for a hash with no invite payload', () => {
    expect(decodeInviteFromHash('')).toBeNull()
    expect(decodeInviteFromHash('#')).toBeNull()
    expect(decodeInviteFromHash('#somethingelse=1')).toBeNull()
  })

  it('returns null rather than throwing on garbage input', () => {
    expect(decodeInviteFromHash('#invite=not-valid-base64url-json!!!')).toBeNull()
    expect(decodeInviteFromHash('#invite=' + btoa('not json'))).toBeNull()
  })

  it('returns null when required fields are missing (defends downstream code from a half-formed invite)', () => {
    const encoded = btoa(JSON.stringify({ v: 1, workspaceId: 'x' }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    expect(decodeInviteFromHash(`#invite=${encoded}`)).toBeNull()
  })

  it('decodes the fixed E2E invite hash', () => {
    const invite = decodeInviteFromHash(`#${E2E_INVITE_HASH}`)
    expect(invite?.workspaceName).toBe('test-ws')
    expect(invite?.allowList.emails).toEqual(['alice@e2e.test', 'bob@e2e.test'])
  })
})
