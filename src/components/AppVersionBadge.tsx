import { appBuildLabel } from '../config'

/** One unobtrusive build marker shared by every route and signed-in state. */
export function AppVersionBadge() {
  return (
    <span
      className="pointer-events-none fixed bottom-1 right-2 z-40 rounded bg-base-100/75 px-1 font-mono text-[0.6rem] text-base-content/40 backdrop-blur"
      data-testid="app-version"
    >
      {appBuildLabel()}
    </span>
  )
}
