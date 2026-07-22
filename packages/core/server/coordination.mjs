import { randomBytes, randomUUID } from 'node:crypto'

const TOPIC = '__relay_coord_v1__'
const PRESENCE_TTL_MS = 45_000
const SEEK_TTL_MS = 20_000
const ROOM_TTL_MS = 60_000
const SWEEP_MS = 10_000
const MAX_SCOPE_LENGTH = 160
const MAX_MEMBER_LENGTH = 160
const MAX_DATA_LENGTH = 6_000
const MAX_TAGS = 12
const MAX_TAG_LENGTH = 96
const MAX_EXCLUDED_MEMBERS = 100
const MAX_COMMANDS_PER_MINUTE = 240
const MAX_COMMANDS_PER_CLIENT_PER_MINUTE = 600
const MATCH_PROPOSAL_TTL_MS = 12_000
const MAX_ACTIVE_SCOPES_PER_KIND = 8
const MAX_CHANNELS_PER_SOCKET = 4
const MAX_CHANNEL_EVENT_LENGTH = 48
const MAX_CHANNEL_DATA_LENGTH = 220_000
const MAX_MESSAGE_ID_LENGTH = 96
const MAX_ENTRIES_PER_SCOPE = 1_000
const DEFAULT_ROOM_PAGE_SIZE = 100
const MAX_ROOM_PAGE_SIZE = 200

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const validText = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max
const now = () => Date.now()

function direct(socket, type, payload = {}) {
  if (socket.readyState !== 1) return
  socket.send(JSON.stringify({ topic: TOPIC, payload: { v: 1, type, ...payload } }))
}

function pruneMap(map, ttl, timestamp = now()) {
  let changed = false
  for (const [socket, entry] of map) {
    if (socket.readyState !== 1 || timestamp - entry.seenAt > ttl) {
      map.delete(socket)
      changed = true
    }
  }
  return changed
}

export function attachCoordinationServer(wss) {
  const presence = new Map()
  const seekers = new Map()
  const seekWatchers = new Map()
  const rooms = new Map()
  const roomWatchers = new Map()
  const pendingMatches = new Map()
  const pendingMatchBySocket = new Map()
  const channels = new Map()
  const socketState = new WeakMap()
  const connectedSockets = new Set()
  const clientRates = new Map()
  const metrics = {
    connectionsTotal: 0,
    commandsTotal: 0,
    rejectedCommandsTotal: 0,
    rateLimitedTotal: 0,
    presenceUpdatesTotal: 0,
    seekUpdatesTotal: 0,
    matchProposalsTotal: 0,
    matchesTotal: 0,
    roomUpdatesTotal: 0,
    channelMessagesTotal: 0,
    channelDeliveriesTotal: 0,
  }

  const mapFor = (root, scope) => {
    let value = root.get(scope)
    if (!value) {
      value = new Map()
      root.set(scope, value)
    }
    return value
  }

  const stateFor = socket => {
    let value = socketState.get(socket)
    if (!value) {
      value = {
        id: randomUUID(),
        presenceScopes: new Set(),
        seekPools: new Set(),
        watchedSeekPools: new Set(),
        roomDirectories: new Set(),
        watchedDirectories: new Set(),
        channels: new Set(),
        rateStartedAt: now(),
        rateCount: 0,
        capabilities: new Set(),
      }
      socketState.set(socket, value)
    }
    return value
  }

  const allowCommand = socket => {
    const state = stateFor(socket)
    const timestamp = now()
    if (timestamp - state.rateStartedAt >= 60_000) {
      state.rateStartedAt = timestamp
      state.rateCount = 0
    }
    state.rateCount += 1

    const key = socket.peerlyClientKey || state.id
    let clientRate = clientRates.get(key)
    if (!clientRate || timestamp - clientRate.startedAt >= 60_000) {
      clientRate = { startedAt: timestamp, lastSeenAt: timestamp, count: 0 }
      clientRates.set(key, clientRate)
    }
    clientRate.lastSeenAt = timestamp
    clientRate.count += 1
    return state.rateCount <= MAX_COMMANDS_PER_MINUTE &&
      clientRate.count <= MAX_COMMANDS_PER_CLIENT_PER_MINUTE
  }

  const sendPresence = scope => {
    const entries = presence.get(scope)
    if (!entries) return
    pruneMap(entries, PRESENCE_TTL_MS)
    const members = [...entries.values()].slice(0, MAX_ENTRIES_PER_SCOPE).map(entry => ({
      connectionId: entry.connectionId,
      memberId: entry.memberId,
      data: entry.data,
    }))
    for (const socket of entries.keys()) direct(socket, 'presence.snapshot', { scope, members })
    if (entries.size === 0) presence.delete(scope)
  }

  const seekStats = pool => {
    const entries = seekers.get(pool)
    if (!entries) return { total: 0, tags: {} }
    pruneMap(entries, SEEK_TTL_MS)
    const users = new Map()
    for (const entry of entries.values()) {
      const tags = users.get(entry.memberId) ?? new Set()
      for (const tag of entry.tags) tags.add(tag)
      users.set(entry.memberId, tags)
    }
    const tags = {}
    for (const values of users.values()) {
      for (const tag of values) tags[tag] = (tags[tag] ?? 0) + 1
    }
    return { total: users.size, tags }
  }

  const sendSeekStats = pool => {
    const entries = seekers.get(pool)
    const stats = seekStats(pool)
    for (const socket of seekWatchers.get(pool)?.keys() ?? []) {
      direct(socket, 'seek.stats', { pool, ...stats })
    }
    if (entries?.size === 0) seekers.delete(pool)
  }

  const sendMatch = (socket, match, side) => {
    const other = match.sides[side === 0 ? 1 : 0]
    direct(socket, 'seek.match', {
      pool: match.pool,
      matchId: match.matchId,
      roomCode: match.roomCode,
      initiator: side === 0,
      partner: { memberId: other.entry.memberId, data: other.entry.data },
    })
  }

  const restorePendingSide = (match, side) => {
    const item = match.sides[side]
    if (item.socket.readyState !== 1 || !socketState.has(item.socket)) return
    mapFor(seekers, match.pool).set(item.socket, { ...item.entry, seenAt: now() })
    stateFor(item.socket).seekPools.add(match.pool)
  }

  const cancelPendingMatch = (matchId, exceptSocket) => {
    const match = pendingMatches.get(matchId)
    if (!match) return
    pendingMatches.delete(matchId)
    const restoredSockets = []
    for (let side = 0; side < match.sides.length; side += 1) {
      const socket = match.sides[side].socket
      pendingMatchBySocket.delete(socket)
      if (socket !== exceptSocket) {
        restorePendingSide(match, side)
        restoredSockets.push(socket)
      }
    }
    sendSeekStats(match.pool)
    // setSeek is durable client intent, not a polling heartbeat. Retry matching
    // restored seekers now; otherwise a missed proposal acknowledgement would
    // leave both sides parked forever until one reconnects.
    for (const socket of restoredSockets) tryMatch(match.pool, socket)
  }

  const tryMatch = (pool, socket) => {
    const entries = seekers.get(pool)
    const mine = entries?.get(socket)
    if (!entries || !mine) return false
    for (const [otherSocket, other] of entries) {
      if (otherSocket === socket || other.memberId === mine.memberId) continue
      if (mine.excluded.includes(other.memberId) || other.excluded.includes(mine.memberId)) continue
      if (!mine.tags.some(tag => other.tags.includes(tag))) continue
      entries.delete(socket)
      entries.delete(otherSocket)
      stateFor(socket).seekPools.delete(pool)
      stateFor(otherSocket).seekPools.delete(pool)
      const matchId = randomUUID()
      const roomCode = randomBytes(16).toString('hex')
      const supportsAck = stateFor(socket).capabilities.has('seek-ack') &&
        stateFor(otherSocket).capabilities.has('seek-ack')
      const match = {
        pool,
        matchId,
        roomCode,
        sides: [
          { socket, entry: mine },
          { socket: otherSocket, entry: other },
        ],
        acknowledgements: new Set(),
        expiresAt: now() + MATCH_PROPOSAL_TTL_MS,
      }
      metrics.matchProposalsTotal += 1
      if (supportsAck) {
        pendingMatches.set(matchId, match)
        pendingMatchBySocket.set(socket, matchId)
        pendingMatchBySocket.set(otherSocket, matchId)
        direct(socket, 'seek.proposal', { pool, matchId })
        direct(otherSocket, 'seek.proposal', { pool, matchId })
      } else {
        // Rolling-deploy fallback: old clients do not understand proposals.
        metrics.matchesTotal += 1
        sendMatch(socket, match, 0)
        sendMatch(otherSocket, match, 1)
      }
      sendSeekStats(pool)
      return true
    }
    return false
  }

  const sendRooms = directory => {
    const entries = rooms.get(directory)
    if (entries) pruneMap(entries, ROOM_TTL_MS)
    const listing = entries
      ? [...entries.values()].map(entry => ({ roomId: entry.roomId, data: entry.data }))
      : []
    for (const [socket, page] of roomWatchers.get(directory) ?? []) {
      const cursor = Math.min(page.cursor, listing.length)
      const roomsPage = listing.slice(cursor, cursor + page.limit)
      const nextCursor = cursor + roomsPage.length < listing.length
        ? cursor + roomsPage.length
        : undefined
      direct(socket, 'room.snapshot', {
        directory,
        rooms: roomsPage,
        cursor,
        nextCursor,
        total: listing.length,
      })
    }
    if (entries?.size === 0) rooms.delete(directory)
  }

  const sendChannelSnapshot = channel => {
    const entries = channels.get(channel)
    const members = entries
      ? [...entries.entries()].map(([socket, entry]) => ({
          connectionId: stateFor(socket).id,
          memberId: entry.memberId,
        }))
      : []
    for (const socket of entries?.keys() ?? []) {
      direct(socket, 'channel.snapshot', { channel, members })
    }
    if (entries?.size === 0) channels.delete(channel)
  }

  const removeSocket = socket => {
    const state = socketState.get(socket)
    if (!state) return
    const pendingMatchId = pendingMatchBySocket.get(socket)
    if (pendingMatchId) cancelPendingMatch(pendingMatchId, socket)
    for (const scope of state.presenceScopes) {
      presence.get(scope)?.delete(socket)
      sendPresence(scope)
    }
    for (const pool of state.seekPools) {
      seekers.get(pool)?.delete(socket)
      sendSeekStats(pool)
    }
    for (const pool of state.watchedSeekPools) {
      seekWatchers.get(pool)?.delete(socket)
      if (seekWatchers.get(pool)?.size === 0) seekWatchers.delete(pool)
    }
    for (const directory of state.roomDirectories) {
      rooms.get(directory)?.delete(socket)
      sendRooms(directory)
    }
    for (const directory of state.watchedDirectories) {
      roomWatchers.get(directory)?.delete(socket)
      if (roomWatchers.get(directory)?.size === 0) roomWatchers.delete(directory)
    }
    for (const channel of state.channels) {
      channels.get(channel)?.delete(socket)
      sendChannelSnapshot(channel)
    }
    socketState.delete(socket)
  }

  const handle = (socket, command) => {
    // The WebSocket is shared with Trystero's own signaling messages. Count
    // only messages that explicitly target the coordinator, while treating a
    // malformed coordinator envelope as a rejected command.
    if (!isRecord(command) || command.type !== 'coord') return
    metrics.commandsTotal += 1
    if (command.v !== 1) {
      metrics.rejectedCommandsTotal += 1
      return
    }
    if (!allowCommand(socket)) {
      metrics.rateLimitedTotal += 1
      direct(socket, 'error', { code: 'rate-limit' })
      return
    }
    const state = stateFor(socket)
    const timestamp = now()

    if (command.action === 'hello') {
      const capabilities = Array.isArray(command.capabilities)
        ? command.capabilities.filter(value => typeof value === 'string' && value.length <= 40)
        : []
      state.capabilities = new Set(capabilities)
      direct(socket, 'ready', { connectionId: state.id })
      return
    }

    if (command.action === 'presence.set') {
      if (!validText(command.scope, MAX_SCOPE_LENGTH) ||
          !validText(command.memberId, MAX_MEMBER_LENGTH) ||
          typeof command.data !== 'string' || command.data.length > MAX_DATA_LENGTH) return
      if (!state.presenceScopes.has(command.scope) &&
          state.presenceScopes.size >= MAX_ACTIVE_SCOPES_PER_KIND) {
        direct(socket, 'error', { code: 'presence-scope-limit' })
        return
      }
      const entries = mapFor(presence, command.scope)
      if (!entries.has(socket) && entries.size >= MAX_ENTRIES_PER_SCOPE) {
        metrics.rejectedCommandsTotal += 1
        direct(socket, 'error', { code: 'presence-capacity' })
        return
      }
      entries.set(socket, {
        connectionId: state.id,
        memberId: command.memberId,
        data: command.data,
        seenAt: timestamp,
      })
      state.presenceScopes.add(command.scope)
      metrics.presenceUpdatesTotal += 1
      sendPresence(command.scope)
      return
    }

    if (command.action === 'presence.clear' && validText(command.scope, MAX_SCOPE_LENGTH)) {
      presence.get(command.scope)?.delete(socket)
      state.presenceScopes.delete(command.scope)
      metrics.presenceUpdatesTotal += 1
      sendPresence(command.scope)
      return
    }

    if (command.action === 'seek.set') {
      if (!validText(command.pool, MAX_SCOPE_LENGTH) ||
          !validText(command.memberId, MAX_MEMBER_LENGTH) ||
          typeof command.data !== 'string' || command.data.length > MAX_DATA_LENGTH ||
          !Array.isArray(command.tags)) return
      const tags = [...new Set(command.tags.filter(tag => validText(tag, MAX_TAG_LENGTH)))].slice(0, MAX_TAGS)
      const excluded = Array.isArray(command.excluded)
        ? [...new Set(command.excluded.filter(memberId => validText(memberId, MAX_MEMBER_LENGTH)))]
          .slice(0, MAX_EXCLUDED_MEMBERS)
        : []
      if (tags.length === 0) return
      if (!state.seekPools.has(command.pool) &&
          state.seekPools.size >= MAX_ACTIVE_SCOPES_PER_KIND) {
        direct(socket, 'error', { code: 'seek-pool-limit' })
        return
      }
      if (pendingMatchBySocket.has(socket)) return
      const entries = mapFor(seekers, command.pool)
      if (!entries.has(socket) && entries.size >= MAX_ENTRIES_PER_SCOPE) {
        metrics.rejectedCommandsTotal += 1
        direct(socket, 'error', { code: 'seek-capacity' })
        return
      }
      entries.set(socket, {
        memberId: command.memberId,
        tags,
        excluded,
        data: command.data,
        seenAt: timestamp,
      })
      state.seekPools.add(command.pool)
      metrics.seekUpdatesTotal += 1
      if (!tryMatch(command.pool, socket)) sendSeekStats(command.pool)
      return
    }

    if (command.action === 'seek.watch' && validText(command.pool, MAX_SCOPE_LENGTH)) {
      if (!state.watchedSeekPools.has(command.pool) &&
          state.watchedSeekPools.size >= MAX_ACTIVE_SCOPES_PER_KIND) {
        direct(socket, 'error', { code: 'seek-watch-limit' })
        return
      }
      const watchers = mapFor(seekWatchers, command.pool)
      const isNew = !watchers.has(socket)
      watchers.set(socket, true)
      state.watchedSeekPools.add(command.pool)
      if (isNew) sendSeekStats(command.pool)
      return
    }

    if (command.action === 'seek.unwatch' && validText(command.pool, MAX_SCOPE_LENGTH)) {
      seekWatchers.get(command.pool)?.delete(socket)
      state.watchedSeekPools.delete(command.pool)
      if (seekWatchers.get(command.pool)?.size === 0) seekWatchers.delete(command.pool)
      return
    }

    if (command.action === 'seek.clear' && validText(command.pool, MAX_SCOPE_LENGTH)) {
      const pendingMatchId = pendingMatchBySocket.get(socket)
      const pendingMatch = pendingMatchId ? pendingMatches.get(pendingMatchId) : undefined
      if (pendingMatch?.pool === command.pool) cancelPendingMatch(pendingMatchId, socket)
      seekers.get(command.pool)?.delete(socket)
      state.seekPools.delete(command.pool)
      metrics.seekUpdatesTotal += 1
      sendSeekStats(command.pool)
      return
    }

    if (command.action === 'seek.ack' &&
        validText(command.pool, MAX_SCOPE_LENGTH) &&
        validText(command.matchId, MAX_MEMBER_LENGTH)) {
      const match = pendingMatches.get(command.matchId)
      if (!match || match.pool !== command.pool || !match.sides.some(side => side.socket === socket)) return
      match.acknowledgements.add(socket)
      if (match.acknowledgements.size !== 2) return
      pendingMatches.delete(match.matchId)
      match.sides.forEach(side => pendingMatchBySocket.delete(side.socket))
      metrics.matchesTotal += 1
      sendMatch(match.sides[0].socket, match, 0)
      sendMatch(match.sides[1].socket, match, 1)
      return
    }

    if (command.action === 'room.watch' && validText(command.directory, MAX_SCOPE_LENGTH)) {
      if (!state.watchedDirectories.has(command.directory) &&
          state.watchedDirectories.size >= MAX_ACTIVE_SCOPES_PER_KIND) {
        direct(socket, 'error', { code: 'room-watch-limit' })
        return
      }
      const watchers = mapFor(roomWatchers, command.directory)
      const previousPage = watchers.get(socket)
      const cursor = Number.isSafeInteger(command.cursor) && command.cursor >= 0 ? command.cursor : 0
      const limit = Number.isSafeInteger(command.limit) && command.limit > 0
        ? Math.min(command.limit, MAX_ROOM_PAGE_SIZE)
        : DEFAULT_ROOM_PAGE_SIZE
      watchers.set(socket, { cursor, limit })
      state.watchedDirectories.add(command.directory)
      if (!previousPage || previousPage.cursor !== cursor || previousPage.limit !== limit) {
        sendRooms(command.directory)
      }
      return
    }

    if (command.action === 'room.unwatch' && validText(command.directory, MAX_SCOPE_LENGTH)) {
      roomWatchers.get(command.directory)?.delete(socket)
      state.watchedDirectories.delete(command.directory)
      if (roomWatchers.get(command.directory)?.size === 0) roomWatchers.delete(command.directory)
      return
    }

    if (command.action === 'room.set') {
      if (!validText(command.directory, MAX_SCOPE_LENGTH) ||
          !validText(command.roomId, MAX_MEMBER_LENGTH) ||
          typeof command.data !== 'string' || command.data.length > MAX_DATA_LENGTH) return
      if (!state.roomDirectories.has(command.directory) &&
          state.roomDirectories.size >= MAX_ACTIVE_SCOPES_PER_KIND) {
        direct(socket, 'error', { code: 'room-directory-limit' })
        return
      }
      const entries = mapFor(rooms, command.directory)
      if (!entries.has(socket) && entries.size >= MAX_ENTRIES_PER_SCOPE) {
        metrics.rejectedCommandsTotal += 1
        direct(socket, 'error', { code: 'room-capacity' })
        return
      }
      entries.set(socket, {
        roomId: command.roomId,
        data: command.data,
        seenAt: timestamp,
      })
      state.roomDirectories.add(command.directory)
      metrics.roomUpdatesTotal += 1
      sendRooms(command.directory)
      return
    }

    if (command.action === 'room.clear' && validText(command.directory, MAX_SCOPE_LENGTH)) {
      rooms.get(command.directory)?.delete(socket)
      state.roomDirectories.delete(command.directory)
      metrics.roomUpdatesTotal += 1
      sendRooms(command.directory)
      return
    }

    if (command.action === 'channel.watch') {
      if (!validText(command.channel, MAX_SCOPE_LENGTH) ||
          !validText(command.memberId, MAX_MEMBER_LENGTH)) return
      if (!state.channels.has(command.channel) && state.channels.size >= MAX_CHANNELS_PER_SOCKET) {
        direct(socket, 'error', { code: 'channel-limit' })
        return
      }
      const entries = mapFor(channels, command.channel)
      const previous = entries.get(socket)
      entries.set(socket, { memberId: command.memberId })
      state.channels.add(command.channel)
      if (!previous || previous.memberId !== command.memberId) sendChannelSnapshot(command.channel)
      return
    }

    if (command.action === 'channel.unwatch' && validText(command.channel, MAX_SCOPE_LENGTH)) {
      channels.get(command.channel)?.delete(socket)
      state.channels.delete(command.channel)
      sendChannelSnapshot(command.channel)
      return
    }

    if (command.action === 'channel.publish') {
      if (!validText(command.channel, MAX_SCOPE_LENGTH) ||
          !state.channels.has(command.channel) ||
          !validText(command.event, MAX_CHANNEL_EVENT_LENGTH) ||
          !validText(command.messageId, MAX_MESSAGE_ID_LENGTH) ||
          typeof command.data !== 'string' || command.data.length > MAX_CHANNEL_DATA_LENGTH ||
          (command.targetConnectionId !== undefined &&
            !validText(command.targetConnectionId, MAX_MEMBER_LENGTH))) return
      const entries = channels.get(command.channel)
      const sender = entries?.get(socket)
      if (!entries || !sender) return
      metrics.channelMessagesTotal += 1
      for (const target of entries.keys()) {
        if (target === socket) continue
        if (command.targetConnectionId && stateFor(target).id !== command.targetConnectionId) continue
        metrics.channelDeliveriesTotal += 1
        direct(target, 'channel.message', {
          channel: command.channel,
          event: command.event,
          messageId: command.messageId,
          senderConnectionId: state.id,
          senderMemberId: sender.memberId,
          data: command.data,
        })
      }
    }
  }

  wss.on('connection', socket => {
    connectedSockets.add(socket)
    metrics.connectionsTotal += 1
    stateFor(socket)
    socket.on('message', data => {
      try {
        const command = JSON.parse(data.toString('utf8'))
        handle(socket, command)
      } catch {
        // Trystero messages and malformed input are handled/ignored elsewhere.
      }
    })
    socket.on('close', () => {
      connectedSockets.delete(socket)
      removeSocket(socket)
    })
  })

  const sweep = setInterval(() => {
    for (const [scope, entries] of presence) if (pruneMap(entries, PRESENCE_TTL_MS)) sendPresence(scope)
    for (const [pool, entries] of seekers) if (pruneMap(entries, SEEK_TTL_MS)) sendSeekStats(pool)
    for (const [directory, entries] of rooms) if (pruneMap(entries, ROOM_TTL_MS)) sendRooms(directory)
    for (const [matchId, match] of pendingMatches) {
      if (match.expiresAt <= now()) cancelPendingMatch(matchId)
    }
    const rateCutoff = now() - 2 * 60_000
    for (const [key, rate] of clientRates) {
      if (rate.lastSeenAt < rateCutoff) clientRates.delete(key)
    }
  }, SWEEP_MS)
  sweep.unref()

  return {
    metrics() {
      const countEntries = root => [...root.values()]
        .reduce((total, entries) => total + entries.size, 0)
      return {
        ...metrics,
        activeConnections: connectedSockets.size,
        activePresenceScopes: presence.size,
        activePresenceEntries: countEntries(presence),
        activeSeekPools: seekers.size,
        activeSeekers: countEntries(seekers),
        activeSeekWatchers: countEntries(seekWatchers),
        activeRoomDirectories: rooms.size,
        activeRooms: countEntries(rooms),
        activeRoomWatchers: countEntries(roomWatchers),
        activeChannels: channels.size,
        activeChannelMembers: countEntries(channels),
        pendingMatches: pendingMatches.size,
        trackedClients: clientRates.size,
      }
    },
    close() {
      clearInterval(sweep)
      connectedSockets.clear()
      presence.clear()
      seekers.clear()
      seekWatchers.clear()
      rooms.clear()
      roomWatchers.clear()
      channels.clear()
      pendingMatches.clear()
      pendingMatchBySocket.clear()
      clientRates.clear()
    },
  }
}

export const COORDINATION_TOPIC = TOPIC
