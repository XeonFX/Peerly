import { createAvatarStore } from '@peerly/core'
import { APP_STORAGE_SCOPE } from '../config'

/** This app's avatar blobs. The store itself lives in @peerly/core. */
const store = createAvatarStore(APP_STORAGE_SCOPE)

export const saveAvatar = store.save
export const loadAvatar = store.load
export const deleteAvatar = store.remove
export const loadAvatarDataUrl = store.loadDataUrl
