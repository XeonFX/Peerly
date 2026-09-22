import { env } from 'cloudflare:workers'
import { runInDurableObject } from 'cloudflare:test'
import { describeGatewayStorageContract } from '../../src/adapters/gatewayStorage.contract.js'
import {
  createSqlGatewayStorage, GATEWAY_SCHEMA,
} from '../../src/adapters/durableObject/sqlGatewayStorage.js'

/**
 * The SQLite adapter, held to the same contract as the in-memory one against
 * real workerd — real SQLite semantics, real constraint violations, real
 * integer coercion.
 *
 * The whole case body runs *inside* `runInDurableObject`, because a storage
 * handle is only valid for the request that obtained it; using one afterwards
 * fails with a cross-request I/O error. A distinct object per case keeps them
 * isolated without relying on the pool's storage isolation, which this project
 * disables (WebSocket tests are unsupported under it).
 *
 * Any SQLite-backed class will do — this wants a storage handle, not that
 * class's behaviour, and it creates its own schema. `SIGNAL_SCOPES` is used
 * because it is the smallest one that exists in both apps.
 */
let counter = 0

describeGatewayStorageContract('durable-object sqlite', async body => {
  counter += 1
  const stub = env.SIGNAL_SCOPES.getByName(`peerly:sql-contract-${counter}`)
  await runInDurableObject(stub, (_instance, state) => {
    state.storage.sql.exec(GATEWAY_SCHEMA)
    body(createSqlGatewayStorage(state.storage.sql))
  })
})
