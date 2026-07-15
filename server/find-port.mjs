import net from 'net'

export function findFreePort(start = 8080, maxAttempts = 20) {
  return new Promise((resolve, reject) => {
    let port = start
    let attempts = 0

    const tryPort = () => {
      if (attempts >= maxAttempts) {
        reject(new Error(`No free port found between ${start} and ${start + maxAttempts - 1}`))
        return
      }

      const server = net.createServer()
      server.once('error', () => {
        attempts++
        port++
        tryPort()
      })
      server.once('listening', () => {
        server.close(() => resolve(port))
      })
      server.listen(port)
    }

    tryPort()
  })
}