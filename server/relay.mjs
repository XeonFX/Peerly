import { writeFileSync } from 'fs'
import { createWsRelayServer } from '@trystero-p2p/ws-relay/server'
import { attachCoordinationServer } from './coordination.mjs'

const port = Number(process.env.RELAY_PORT) || 8080

const relay = await createWsRelayServer({ port })
await relay.ready
attachCoordinationServer(relay.wss)

writeFileSync('.relay-port', String(port))

console.log(`Trystero relay ready on ws://localhost:${port}`)
