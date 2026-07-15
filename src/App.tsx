import { useEffect, useState } from 'react'
import { isE2eAuthBypass } from './collab/e2eAuth'
import { WorkspaceAuthManager } from './collab/workspaceAuth'
import { JoinScreen } from './components/JoinScreen'
import { Workspace } from './components/Workspace'
import { useWorkspaceAuth } from './hooks/useWorkspaceAuth'
import {
  hydrateSessionAvatar,
  leaveWorkspace,
  loadPersistedSession,
  loadIdToken,
  loadSession,
  migrateLegacySession,
  saveIdCredentials,
  saveSession,
  type Session,
} from './session'
import './App.css'

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)

  const { peerHandshake } = useWorkspaceAuth(session, allowList => {
    setSession(prev => {
      if (!prev) return prev
      const next = { ...prev, allowList }
      saveSession(next)
      return next
    })
  })

  useEffect(() => {
    void (async () => {
      await migrateLegacySession()
      let loaded = loadSession()
      if (!loaded) {
        const persisted = loadPersistedSession()
        if (persisted && !loadIdToken() && isE2eAuthBypass()) {
          const manager = new WorkspaceAuthManager({
            workspaceId: persisted.workspaceId,
            creatorKeyId: persisted.creatorKeyId,
            allowList: persisted.allowList,
          })
          await manager.signInWithE2eEmail(persisted.identityEmail)
          const token = manager.getIdToken()
          if (token) {
            saveIdCredentials(token, persisted.identityProvider)
            const next = { ...persisted }
            saveSession(next)
            loaded = next
          }
        } else if (persisted && !loadIdToken()) {
          leaveWorkspace()
        }
      }
      if (loaded) {
        setSession(await hydrateSessionAvatar(loaded))
      }
      setReady(true)
    })()
  }, [])

  const updateSession = (patch: Partial<Session>) => {
    setSession(prev => {
      if (!prev) return prev
      const next = { ...prev, ...patch }
      saveSession(next)
      return next
    })
  }

  if (!ready) {
    return null
  }

  if (!session) {
    return (
      <JoinScreen
        onJoined={async next => {
          setSession(await hydrateSessionAvatar(next))
        }}
      />
    )
  }

  return (
    <Workspace
      session={session}
      peerHandshake={peerHandshake}
      onSessionChange={updateSession}
      onLeave={() => {
        leaveWorkspace()
        setSession(null)
      }}
    />
  )
}

export default App