import { deleteAvatar, loadAvatarDataUrl, saveAvatar } from '../utils/avatarStore'
import { processAvatarImage } from '../utils/avatarImage'

export async function uploadAvatar(
  file: File,
  previousAvatarId?: string
): Promise<{ avatarId: string; dataUrl: string }> {
  const { blob, dataUrl } = await processAvatarImage(file)
  const avatarId = crypto.randomUUID()
  await saveAvatar(avatarId, blob)
  if (previousAvatarId) {
    await deleteAvatar(previousAvatarId)
  }
  return { avatarId, dataUrl }
}

export async function removeAvatar(avatarId?: string): Promise<void> {
  if (avatarId) {
    await deleteAvatar(avatarId)
  }
}

export async function resolveAvatarPreview(avatarId?: string): Promise<string | undefined> {
  if (!avatarId) return undefined
  return (await loadAvatarDataUrl(avatarId)) ?? undefined
}

export async function migrateLegacyAvatarDataUrl(dataUrl: string): Promise<string> {
  const response = await fetch(dataUrl)
  const blob = await response.blob()
  const avatarId = crypto.randomUUID()
  await saveAvatar(avatarId, blob)
  return avatarId
}