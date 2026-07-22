import WebSocket from 'ws'

const target = process.env.RELAY_LOAD_URL
const clients = Number(process.env.RELAY_LOAD_CLIENTS || 50)
const runMs = Number(process.env.RELAY_LOAD_DURATION_MS || 30_000)
const churnEveryMs = Number(process.env.RELAY_LOAD_CHURN_MS || 0)
if (!target || ![50, 100, 500].includes(clients)) {
  console.error('Set RELAY_LOAD_URL and RELAY_LOAD_CLIENTS=50|100|500')
  process.exit(2)
}

const sockets = new Set()
let opened = 0
let received = 0
let errors = 0
const connect = index => new Promise(resolve => {
  const socket = new WebSocket(target, { perMessageDeflate: false })
  sockets.add(socket)
  socket.once('open', () => {
    opened += 1
    socket.send(JSON.stringify({ type: 'subscribe', topic: `load-${index % 10}` }))
    socket.send(JSON.stringify({ type: 'publish', topic: `load-${index % 10}`, payload: { index } }))
    resolve()
  })
  socket.on('message', () => { received += 1 })
  socket.on('error', () => { errors += 1; resolve() })
  socket.on('close', () => sockets.delete(socket))
})

await Promise.all(Array.from({ length: clients }, (_, index) => connect(index)))
const churn = churnEveryMs > 0 ? setInterval(() => {
  const socket = sockets.values().next().value
  socket?.close(1000, 'load-test churn')
  void connect(Math.floor(Math.random() * clients))
}, churnEveryMs) : null

await new Promise(resolve => setTimeout(resolve, runMs))
if (churn) clearInterval(churn)
for (const socket of sockets) socket.close(1000, 'load test complete')
console.log(JSON.stringify({ requested: clients, opened, received, errors }, null, 2))
if (opened < clients || errors > Math.max(1, clients * 0.01)) process.exitCode = 1

