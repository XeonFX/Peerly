/**
 * Plan how to move local media from `previous` to `next` on a live PeerConnection.
 *
 * Chrome frequently rejects mid-call renegotiation when RTP header extension IDs
 * are reassigned (Chrome↔Firefox is the usual repro). Full removeStream+addStream
 * always renegotiates; replaceTrack for same-kind tracks avoids a new m-line
 * renegotiation when possible.
 */

export type TrackOp =
  | { op: 'replace'; kind: 'audio' | 'video'; oldTrack: MediaStreamTrack; newTrack: MediaStreamTrack }
  | { op: 'add'; kind: 'audio' | 'video'; track: MediaStreamTrack; stream: MediaStream }
  | { op: 'remove'; kind: 'audio' | 'video'; track: MediaStreamTrack }

export function planTrackOps(
  previous: MediaStream | null,
  next: MediaStream | null
): TrackOp[] {
  if (!previous && !next) return []
  if (!previous && next) {
    return next.getTracks().map(track => ({
      op: 'add' as const,
      kind: track.kind as 'audio' | 'video',
      track,
      stream: next,
    }))
  }
  if (previous && !next) {
    return previous.getTracks().map(track => ({
      op: 'remove' as const,
      kind: track.kind as 'audio' | 'video',
      track,
    }))
  }
  // both non-null
  const prev = previous!
  const nxt = next!
  const ops: TrackOp[] = []
  for (const kind of ['audio', 'video'] as const) {
    const oldTrack = prev.getTracks().find(t => t.kind === kind)
    const newTrack = nxt.getTracks().find(t => t.kind === kind)
    if (oldTrack && newTrack) {
      ops.push({ op: 'replace', kind, oldTrack, newTrack })
    } else if (!oldTrack && newTrack) {
      ops.push({ op: 'add', kind, track: newTrack, stream: nxt })
    } else if (oldTrack && !newTrack) {
      ops.push({ op: 'remove', kind, track: oldTrack })
    }
  }
  return ops
}

/**
 * True when every op is a same-kind replace (no m-line add/remove).
 * Those upgrades are safest on Chrome renegotiation.
 */
export function isReplaceOnlyUpgrade(ops: TrackOp[]): boolean {
  return ops.length > 0 && ops.every(op => op.op === 'replace')
}
