import { createAvatarStore } from '@peerly/core'
import { APP_STORAGE_SCOPE } from '../config'

/** This app's avatar blobs. The store itself lives in @peerly/core. */
export const avatarStore = createAvatarStore(APP_STORAGE_SCOPE)

export const saveAvatar = avatarStore.save
export const loadAvatar = avatarStore.load
export const deleteAvatar = avatarStore.remove
export const loadAvatarDataUrl = avatarStore.loadDataUrl
