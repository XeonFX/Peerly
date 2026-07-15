import { createContext } from 'react'
import type { ChatSlice, ConnectionSlice, MediaSlice, ProfileSlice, WorkspaceSlice } from './collabTypes'

export const ConnectionContext = createContext<ConnectionSlice | null>(null)
export const ChatContext = createContext<ChatSlice | null>(null)
export const MediaContext = createContext<MediaSlice | null>(null)
export const ProfileContext = createContext<ProfileSlice | null>(null)
export const WorkspaceContext = createContext<WorkspaceSlice | null>(null)