/**
 * The user's presentation profile — display name, colour, avatar reference —
 * persisted independently of any workspace.
 *
 * It used to live only inside the workspace session record, so leaving a
 * workspace (which deletes that record) silently reset the profile: change
 * your name and colour, leave, rejoin, and you were back to defaults. Who you
 * are is not workspace state; this store gives it its own lifetime.
 */

const STORAGE_KEY = 'peerly-profile'

export type StoredProfile = {
  userName?: string
  color?: string
  avatarId?: string
}

export function loadStoredProfile(): StoredProfile {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return {
      userName: typeof parsed.userName === 'string' ? parsed.userName : undefined,
      color: typeof parsed.color === 'string' ? parsed.color : undefined,
      avatarId: typeof parsed.avatarId === 'string' ? parsed.avatarId : undefined,
    }
  } catch {
    return {}
  }
}

export function saveStoredProfile(profile: StoredProfile): void {
  try {
    const current = loadStoredProfile()
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...profile }))
  } catch {
    // Profile falls back to session defaults; nothing breaks.
  }
}
