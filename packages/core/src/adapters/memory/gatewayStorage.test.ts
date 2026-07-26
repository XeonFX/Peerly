import { describeGatewayStorageContract } from '../gatewayStorage.contract.js'
import { createMemoryGatewayStorage } from './gatewayStorage.js'

// The in-memory adapter has nothing to set up, so the runner just hands over a
// fresh instance per case.
describeGatewayStorageContract('memory', body => body(createMemoryGatewayStorage()))
