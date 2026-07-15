import { useContext, type Context } from 'react'
import type { CollabState } from './collabTypes'
import {
  ChatContext,
  ConnectionContext,
  MediaContext,
  ProfileContext,
  WorkspaceContext,
} from './collabContexts'
import type { ChatSlice, ConnectionSlice, MediaSlice, ProfileSlice, WorkspaceSlice } from './collabTypes'

function useSlice<T>(context: Context<T | null>, name: string): T {
  const value = useContext(context)
  if (!value) {
    throw new Error(`${name} must be used within CollabProvider`)
  }
  return value
}

export function useConnectionSlice(): ConnectionSlice {
  return useSlice(ConnectionContext, 'useConnectionSlice')
}

export function useChatSlice(): ChatSlice {
  return useSlice(ChatContext, 'useChatSlice')
}

export function useMediaSlice(): MediaSlice {
  return useSlice(MediaContext, 'useMediaSlice')
}

export function useProfileSlice(): ProfileSlice {
  return useSlice(ProfileContext, 'useProfileSlice')
}

export function useWorkspaceSlice(): WorkspaceSlice {
  return useSlice(WorkspaceContext, 'useWorkspaceSlice')
}

/** @deprecated Prefer scoped hooks: useConnectionSlice, useChatSlice, useMediaSlice, useProfileSlice */
export function useCollabContext(): CollabState {
  const connection = useConnectionSlice()
  const chat = useChatSlice()
  const media = useMediaSlice()
  const profile = useProfileSlice()
  const workspace = useWorkspaceSlice()
  return { ...connection, ...chat, ...media, ...profile, ...workspace }
}