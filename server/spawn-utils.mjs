import { spawn } from 'child_process'

export function createProcessRunner() {
  const children = []

  function run(name, command, args, env = {}) {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: { ...process.env, ...env },
      shell: process.platform === 'win32',
    })
    children.push(child)
    child.on('exit', code => {
      if (code !== 0 && code !== null) {
        shutdown(code)
      }
    })
    return child
  }

  function shutdown(code = 0) {
    for (const child of children) {
      child.kill('SIGTERM')
    }
    process.exit(code)
  }

  process.on('SIGINT', () => shutdown(0))
  process.on('SIGTERM', () => shutdown(0))

  return { run, shutdown, children }
}