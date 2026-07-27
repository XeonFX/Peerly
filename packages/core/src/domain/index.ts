/**
 * Rules with no I/O. Every export here is a pure function or a value type, so
 * the behaviour it encodes can be tested without a Durable Object, a socket,
 * a clock, or a browser — which is the whole point of the layer.
 *
 * App-specific rules (matchmaking, room directories, host succession) belong
 * to the app that has them, not here.
 */
export {
  createBucket, take,
  type Bucket, type BucketPolicy, type TakeResult,
} from './rateLimit.js'
export {
  decideEnrollment, isSessionValid, nextEpoch,
  type EnrollmentDecision, type SessionRecord,
} from './deviceRegistry.js'
export {
  addToBatch, assignSequence, EMPTY_BATCH, planResume, retentionCutoff, shouldFlush,
  type BatchState, type ResumePlan, type StoredEvent, type StreamEvent,
} from './eventStream.js'
export {
  expiredLease, isLastSocket, leaseFor, renewAtMs,
  type PresenceLease,
} from './presence.js'
export {
  claimableTopics, isScopeAbandoned, routeSignal,
  type Participant, type Routing,
} from './signalRouting.js'
