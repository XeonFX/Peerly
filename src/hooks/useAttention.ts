import { useCallback, useEffect, useState } from 'react'
import { APP_NAME } from '../config'
import {
  loadDmNotificationsEnabled,
  saveDmNotificationsEnabled,
} from '../collab/notificationPreference'
import type { Message } from '../types'

export type NotificationPermissionState = NotificationPermission | 'unsupported'

function currentPermission(): NotificationPermissionState {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
}

function updateFaviconBadge(totalUnread: number): () => void {
  const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')
  if (!link) return () => {}
  const originalHref = link.href
  if (totalUnread <= 0) return () => {}

  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const context = canvas.getContext('2d')
  if (!context) return () => {}
  const gradient = context.createLinearGradient(0, 0, 64, 64)
  gradient.addColorStop(0, '#7c3aed')
  gradient.addColorStop(1, '#0ea5e9')
  context.fillStyle = gradient
  context.beginPath()
  context.roundRect(4, 4, 56, 56, 15)
  context.fill()
  context.fillStyle = '#ffffff'
  context.font = 'bold 34px system-ui, sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(totalUnread > 9 ? '9+' : String(totalUnread), 32, 34)
  link.href = canvas.toDataURL('image/png')
  return () => {
    link.href = originalHref
  }
}

/** Tab/favion attention plus an explicit, DM-only browser-notification opt-in. */
export function useAttention(totalUnread: number, workspaceName: string) {
  const [enabled, setEnabled] = useState(() => loadDmNotificationsEnabled())
  const [permission, setPermission] = useState<NotificationPermissionState>(() =>
    currentPermission()
  )

  useEffect(() => {
    document.title = totalUnread > 0 ? `(${totalUnread}) ${APP_NAME}` : APP_NAME
    const restoreFavicon = updateFaviconBadge(totalUnread)
    return () => {
      document.title = APP_NAME
      restoreFavicon()
    }
  }, [totalUnread])

  const enableNotifications = useCallback(async () => {
    if (typeof Notification === 'undefined') {
      setPermission('unsupported')
      return
    }
    const nextPermission = await Notification.requestPermission()
    setPermission(nextPermission)
    const nextEnabled = nextPermission === 'granted'
    saveDmNotificationsEnabled(nextEnabled)
    setEnabled(nextEnabled)
  }, [])

  const disableNotifications = useCallback(() => {
    saveDmNotificationsEnabled(false)
    setEnabled(false)
  }, [])

  const notifyDirectMessage = useCallback(
    (message: Message) => {
      if (
        !enabled ||
        typeof Notification === 'undefined' ||
        Notification.permission !== 'granted' ||
        document.visibilityState === 'visible'
      ) {
        return
      }
      const notification = new Notification(`${message.senderName} · ${workspaceName}`, {
        body: message.type === 'file' ? `Shared ${message.file?.name ?? 'a file'}` : message.text,
        icon: '/icon-192.png',
        tag: `peerly-dm-${message.channelId}`,
      })
      notification.onclick = () => {
        window.focus()
        notification.close()
      }
    },
    [enabled, workspaceName]
  )

  return {
    notificationsSupported: permission !== 'unsupported',
    notificationsEnabled: enabled && permission === 'granted',
    notificationPermission: permission,
    enableNotifications,
    disableNotifications,
    notifyDirectMessage,
  }
}
