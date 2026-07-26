import { env, runInDurableObject } from 'cloudflare:test'
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
 */
let counter = 0

describeGatewayStorageContract('durable-object sqlite', async body => {
  counter += 1
  const stub = env.WORKSPACES.getByName(`peerly:sql-contract-${counter}`)
  await runInDurableObject(stub, (_instance, state) => {
    state.storage.sql.exec(GATEWAY_SCHEMA)
    body(createSqlGatewayStorage(state.storage.sql))
  })
})
