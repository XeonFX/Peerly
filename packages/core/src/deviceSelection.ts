import { createMediaDevicePrefs, type MediaDevicePrefs } from './mediaDevicePrefs.js'

/**
 * Preferred media device ids and sink routing for one app.
 *
 * The storage keys and the DOM event name are app-scoped so two products in
 * one browser never fight over a preference; everything else was identical in
 * both apps and lives here now.
 */
export type DeviceSelection = MediaDevicePrefs & {
  /** Dispatched when the output sink changes, so open players can re-route. */
  readonly outputChangedEvent: string
}

export function createDeviceSelection(app: string): DeviceSelection {
  const outputChangedEvent = `${app}-audio-output-changed`
  const prefs = createMediaDevicePrefs({
    audioInKey: `${app}-audio-in`,
    videoInKey: `${app}-video-in`,
    audioOutKey: `${app}-audio-out`,
    outputChangedEvent,
  })
  return { ...prefs, outputChangedEvent }
}
