/** Locale-aware HH:MM for message timestamps — identical in every consumer. */
export function formatClockTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
