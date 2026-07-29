import {
  boundedArray,
  boundedString,
  defineCommand,
  FrameError,
  isPlainObject,
} from '../../../packages/core/dist/protocol/index.js'
import {
  derivePrivateMemberId,
  deriveScopeRouteId,
} from '../../../packages/core/worker/realtime/index.mjs'

const MAX_WORKSPACE_MEMBERS = 500
const fail = type => {
  throw new FrameError(`malformed payload for ${type}`)
}

const base64UrlBytes = value => {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4))
  return Uint8Array.from(binary, char => char.charCodeAt(0))
}

const normalizeEmails = emails =>
  [...new Set(emails.map(email => email.trim().toLowerCase()))].sort()

const allowListBytes = (emails, signedAt) =>
  new TextEncoder().encode(`${normalizeEmails(emails).join(',')}|${signedAt}`)

async function verifyAllowList(allowList, creatorKeyId) {
  const match = /^P-256:([A-Za-z0-9_-]{20,}):([A-Za-z0-9_-]{20,})$/.exec(
    creatorKeyId
  )
  if (!match) return false
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      {
        kty: 'EC',
        crv: 'P-256',
        x: match[1],
        y: match[2],
        ext: true,
        key_ops: ['verify'],
      },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    )
    return crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      base64UrlBytes(allowList.signature),
      allowListBytes(allowList.emails, allowList.signedAt)
    )
  } catch {
    return false
  }
}

export const workspaceContentAuthorizeCommand = defineCommand(
  'workspace.content.authorize',
  payload => {
    if (!isPlainObject(payload)) fail('workspace.content.authorize')
    const allowList = payload.allowList
    if (
      !boundedString(payload.capability, 256) ||
      !boundedString(payload.creatorKeyId, 256) ||
      !isPlainObject(allowList) ||
      !boundedArray(
        allowList.emails,
        MAX_WORKSPACE_MEMBERS,
        email => boundedString(email, 254) && email.includes('@')
      ) ||
      allowList.emails.length === 0 ||
      !Number.isSafeInteger(allowList.signedAt) ||
      allowList.signedAt < 0 ||
      !boundedString(allowList.signature, 256)
    ) {
      fail('workspace.content.authorize')
    }
    return {
      capability: payload.capability,
      creatorKeyId: payload.creatorKeyId,
      allowList: {
        emails: normalizeEmails(allowList.emails),
        signedAt: allowList.signedAt,
        signature: allowList.signature,
      },
    }
  }
)

export const dmContentAuthorizeCommand = defineCommand(
  'dm.content.authorize',
  payload => {
    if (
      !isPlainObject(payload) ||
      !boundedString(payload.capability, 256) ||
      !boundedString(payload.peerUserId, 128)
    ) {
      fail('dm.content.authorize')
    }
    return {
      capability: payload.capability,
      peerUserId: payload.peerUserId,
    }
  }
)

export const CONTENT_COMMANDS = [
  workspaceContentAuthorizeCommand,
  dmContentAuthorizeCommand,
]

const required = (value, what) => {
  if (!value) throw new FrameError(`${what} is unavailable`, { code: 'not-found' })
  return value
}

const authorizeChannel = async (deps, context, input) => {
  const channels = required(deps.channels, 'durable content')
  const result = await channels
    .getByName(`${deps.appName}:${input.routeId}`)
    .authorize({
      uid: context.identity,
      publicUserId: context.publicUserId,
      deviceKeyId: context.deviceKeyId,
      principalId: input.principalId,
      expiresAt: deps.clock.nowMs() + 5 * 60_000,
      authority: input.authority,
    })
  if (result.code) {
    throw new FrameError(result.code, { code: 'auth-required' })
  }
  return {
    routeId: input.routeId,
    expiresAt: deps.clock.nowMs() + 5 * 60_000,
  }
}

export function createContentHandlers(deps) {
  return {
    'workspace.content.authorize': async (payload, context) => {
      if (!context.publicUserId || !context.privateMemberId) {
        throw new FrameError('authenticated membership is required', {
          code: 'auth-required',
        })
      }
      if (!(await verifyAllowList(payload.allowList, payload.creatorKeyId))) {
        throw new FrameError('workspace authority signature is invalid', {
          code: 'auth-required',
        })
      }
      const memberIds = await Promise.all(
        payload.allowList.emails.map(email =>
          derivePrivateMemberId(
            deps.opaqueUserIdSecret,
            deps.appName,
            email
          )
        )
      )
      if (!memberIds.includes(context.privateMemberId)) {
        throw new FrameError('workspace membership is required', {
          code: 'auth-required',
        })
      }
      const routeId = await deriveScopeRouteId(
        deps.opaqueUserIdSecret,
        deps.appName,
        'workspace-content',
        payload.capability
      )
      return authorizeChannel(deps, context, {
        routeId,
        principalId: context.privateMemberId,
        authority: {
          version: payload.allowList.signedAt,
          fingerprint: `${payload.creatorKeyId}\n${payload.allowList.signature}`,
          members: memberIds,
        },
      })
    },

    'dm.content.authorize': async (payload, context) => {
      if (!context.publicUserId || payload.peerUserId === context.publicUserId) {
        throw new FrameError('two authenticated participants are required', {
          code: 'auth-required',
        })
      }
      const members = [context.publicUserId, payload.peerUserId].sort()
      const routeId = await deriveScopeRouteId(
        deps.opaqueUserIdSecret,
        deps.appName,
        'dm-content',
        payload.capability
      )
      return authorizeChannel(deps, context, {
        routeId,
        principalId: context.publicUserId,
        authority: {
          version: 1,
          fingerprint: members.join('\n'),
          members,
        },
      })
    },
  }
}
