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
  const socketState = new WeakMap()

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
        rateStartedAt: now(),
        rateCount: 0,
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
    return state.rateCount <= MAX_COMMANDS_PER_MINUTE
  }

  const sendPresence = scope => {
    const entries = presence.get(scope)
    if (!entries) return
    pruneMap(entries, PRESENCE_TTL_MS)
    const members = [...entries.values()].map(entry => ({
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
      direct(socket, 'seek.match', {
        pool,
        matchId,
        roomCode,
        initiator: true,
        partner: { memberId: other.memberId, data: other.data },
      })
      direct(otherSocket, 'seek.match', {
        pool,
        matchId,
        roomCode,
        initiator: false,
        partner: { memberId: mine.memberId, data: mine.data },
      })
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
    for (const socket of roomWatchers.get(directory) ?? []) {
      direct(socket, 'room.snapshot', { directory, rooms: listing })
    }
    if (entries?.size === 0) rooms.delete(directory)
  }

  const removeSocket = socket => {
    const state = socketState.get(socket)
    if (!state) return
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
    socketState.delete(socket)
  }

  const handle = (socket, command) => {
    if (!isRecord(command) || command.type !== 'coord' || command.v !== 1) return
    if (!allowCommand(socket)) {
      direct(socket, 'error', { code: 'rate-limit' })
      return
    }
    const state = stateFor(socket)
    const timestamp = now()

    if (command.action === 'hello') {
      direct(socket, 'ready', { connectionId: state.id })
      return
    }

    if (command.action === 'presence.set') {
      if (!validText(command.scope, MAX_SCOPE_LENGTH) ||
          !validText(command.memberId, MAX_MEMBER_LENGTH) ||
          typeof command.data !== 'string' || command.data.length > MAX_DATA_LENGTH) return
      mapFor(presence, command.scope).set(socket, {
        connectionId: state.id,
        memberId: command.memberId,
        data: command.data,
        seenAt: timestamp,
      })
      state.presenceScopes.add(command.scope)
      sendPresence(command.scope)
      return
    }

    if (command.action === 'presence.clear' && validText(command.scope, MAX_SCOPE_LENGTH)) {
      presence.get(command.scope)?.delete(socket)
      state.presenceScopes.delete(command.scope)
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
      mapFor(seekers, command.pool).set(socket, {
        memberId: command.memberId,
        tags,
        excluded,
        data: command.data,
        seenAt: timestamp,
      })
      state.seekPools.add(command.pool)
      if (!tryMatch(command.pool, socket)) sendSeekStats(command.pool)
      return
    }

    if (command.action === 'seek.watch' && validText(command.pool, MAX_SCOPE_LENGTH)) {
      mapFor(seekWatchers, command.pool).set(socket, true)
      state.watchedSeekPools.add(command.pool)
      sendSeekStats(command.pool)
      return
    }

    if (command.action === 'seek.unwatch' && validText(command.pool, MAX_SCOPE_LENGTH)) {
      seekWatchers.get(command.pool)?.delete(socket)
      state.watchedSeekPools.delete(command.pool)
      if (seekWatchers.get(command.pool)?.size === 0) seekWatchers.delete(command.pool)
      return
    }

    if (command.action === 'seek.clear' && validText(command.pool, MAX_SCOPE_LENGTH)) {
      seekers.get(command.pool)?.delete(socket)
      state.seekPools.delete(command.pool)
      sendSeekStats(command.pool)
      return
    }

    if (command.action === 'room.watch' && validText(command.directory, MAX_SCOPE_LENGTH)) {
      mapFor(roomWatchers, command.directory).set(socket, true)
      state.watchedDirectories.add(command.directory)
      sendRooms(command.directory)
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
      mapFor(rooms, command.directory).set(socket, {
        roomId: command.roomId,
        data: command.data,
        seenAt: timestamp,
      })
      state.roomDirectories.add(command.directory)
      sendRooms(command.directory)
      return
    }

    if (command.action === 'room.clear' && validText(command.directory, MAX_SCOPE_LENGTH)) {
      rooms.get(command.directory)?.delete(socket)
      state.roomDirectories.delete(command.directory)
      sendRooms(command.directory)
    }
  }

  wss.on('connection', socket => {
    stateFor(socket)
    socket.on('message', data => {
      try {
        const command = JSON.parse(data.toString('utf8'))
        handle(socket, command)
      } catch {
        // Trystero messages and malformed input are handled/ignored elsewhere.
      }
    })
    socket.on('close', () => removeSocket(socket))
  })

  const sweep = setInterval(() => {
    for (const [scope, entries] of presence) if (pruneMap(entries, PRESENCE_TTL_MS)) sendPresence(scope)
    for (const [pool, entries] of seekers) if (pruneMap(entries, SEEK_TTL_MS)) sendSeekStats(pool)
    for (const [directory, entries] of rooms) if (pruneMap(entries, ROOM_TTL_MS)) sendRooms(directory)
  }, SWEEP_MS)
  sweep.unref()

  return {
    close() {
      clearInterval(sweep)
      presence.clear()
      seekers.clear()
      seekWatchers.clear()
      rooms.clear()
      roomWatchers.clear()
    },
  }
}

export const COORDINATION_TOPIC = TOPIC
