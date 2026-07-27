import { useEffect, useState } from 'react'
import { base64UrlToBytes } from '@peerly/core'
import { deriveUserId } from '../collab/userId'
import { isE2eAuthBypass } from '../collab/e2eAuth'
import { WorkspaceAuthManager } from '../collab/workspaceAuth'
import {
  hydrateSessionAvatar,
  loadIdentityEmail,
  loadIdentityProvider,
  loadIdentityUserId,
  loadIdToken,
  loadSession,
  migrateLegacySession,
  saveIdCredentials,
  saveSession,
  type Session,
} from '../session'

/**
 * Everything that has to be true before the first render decides anything.
 *
 * This runs once and answers one question — what does this browser already
 * know about who is signed in — from four different eras of how that was
 * stored. Each backfill below exists because a real session got stuck without
 * it, and none is reachable from the others, which is why they are steps
 * rather than branches.
 *
 * `ready` gates rendering rather than the session being non-null: a browser
 * with no session is a legitimate answer, and rendering the join screen
 * before this finishes would flash it at someone who is signed in.
 */
export type SessionBootstrap = {
  session: Session | null
  setSession: React.Dispatch<React.SetStateAction<Session | null>>
  /** False until the questions above are answered, either way. */
  ready: boolean
}

/** The opaque user id derived from a token this app already verified. */
async function userIdFromToken(token: string): Promise<string | null> {
  try {
    const claims = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(token.split('.')[1] ?? ''))
    ) as { iss?: unknown; sub?: unknown }
    if (typeof claims.iss !== 'string' || typeof claims.sub !== 'string') return null
    return await deriveUserId(claims.iss, claims.sub)
  } catch {
    // Malformed token — leave the user id unset; re-auth restores it.
    return null
  }
}

/**
 * E2E keeps a silent mint so a reload does not drop the tester back at
 * sign-in. Guarded by the same build-time flag as the rest of the bypass.
 */
async function remintForE2e(loaded: Session): Promise<void> {
  const manager = new WorkspaceAuthManager({
    workspaceId: loaded.workspaceId,
    creatorKeyId: loaded.creatorKeyId,
    allowList: loaded.allowList,
  })
  await manager.signInWithE2eEmail(loaded.identityEmail)
  const token = manager.getIdToken()
  if (!token) return
  saveIdCredentials(token, loaded.identityProvider, loaded.identityEmail, loaded.identityUserId)
  saveSession(loaded)
}

export function useSessionBootstrap(): SessionBootstrap {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    void (async () => {
      await migrateLegacySession()

      // A session without a live token is still a session: the user lands back
      // in their workspace and the ReauthBanner ('expired' phase) handles
      // getting a fresh token for new handshakes.
      const loaded = loadSession()
      if (loaded && !loadIdToken() && isE2eAuthBypass()) await remintForE2e(loaded)

      // Older sessions predate durable identity metadata. Backfill the user id
      // while the verified workspace session and live token are both present,
      // so leaving the workspace can still render the Home/DM experience.
      const liveToken = loadIdToken()
      if (loaded?.identityUserId && liveToken && !loadIdentityUserId()) {
        saveIdCredentials(liveToken, loaded.identityProvider, loaded.identityEmail, loaded.identityUserId)
      }

      // A signed-in user with no workspace has no stored session to backfill
      // from, so if the opaque user id is still missing — localStorage cleared
      // while a token lingered in sessionStorage — derive it from the live
      // token's already-verified claims. Without it the lobby profile stays
      // null and Home wrongly falls through to the create-workspace screen.
      const provider = loadIdentityProvider()
      const email = loadIdentityEmail()
      if (liveToken && provider && email && !loadIdentityUserId()) {
        const userId = await userIdFromToken(liveToken)
        if (userId) saveIdCredentials(liveToken, provider, email, userId)
      }

      if (loaded) setSession(await hydrateSessionAvatar(loaded))
      setReady(true)
    })()
  }, [])

  return { session, setSession, ready }
}
