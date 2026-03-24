import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { WebSocketServer } from 'ws'

const PORT = Number(process.env.SIGNALING_PORT ?? process.env.PORT ?? 3001)

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' })
  res.end('OK\n')
})

const wss = new WebSocketServer({ server })

/** @type {Map<string, Set<import('ws').WebSocket>>} */
const rooms = new Map()
/** @type {import('ws').WebSocket[]} */
const waitingQueue = []

function randomRoomId() {
  return randomBytes(3).toString('hex').toUpperCase()
}

function safeJsonParse(str) {
  try { return JSON.parse(str) } catch { return null }
}

function safeSend(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
}

function broadcastToRoom(roomId, sender, payload) {
  const peers = rooms.get(roomId)
  if (!peers) return
  const msg = JSON.stringify(payload)
  for (const ws of peers) {
    if (ws !== sender && ws.readyState === ws.OPEN) ws.send(msg)
  }
}

function leaveRoom(ws) {
  const roomId = ws.roomId
  if (!roomId) return
  const peers = rooms.get(roomId)
  if (peers) {
    peers.delete(ws)
    if (peers.size === 0) rooms.delete(roomId)
    else broadcastToRoom(roomId, ws, { type: 'peer-left' })
  }
  ws.roomId = null
}

function removeFromQueue(ws) {
  const idx = waitingQueue.indexOf(ws)
  if (idx !== -1) waitingQueue.splice(idx, 1)
}

function joinRoom(ws, roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, new Set())
  rooms.get(roomId).add(ws)
  ws.roomId = roomId
}

function findMatch(ws) {
  leaveRoom(ws)
  removeFromQueue(ws)

  // Find next available peer
  let matched = null
  while (waitingQueue.length > 0) {
    const candidate = waitingQueue.shift()
    if (candidate.readyState === candidate.OPEN) {
      matched = candidate
      break
    }
  }

  if (matched) {
    const roomId = randomRoomId()
    joinRoom(ws, roomId)
    joinRoom(matched, roomId)
    // The peer that was waiting longer is polite (yields on collision)
    safeSend(matched, { type: 'matched', roomId, polite: true })
    // The new arrival is impolite and makes the first offer
    safeSend(ws, { type: 'matched', roomId, polite: false })
  } else {
    waitingQueue.push(ws)
    safeSend(ws, { type: 'waiting' })
  }
}

wss.on('connection', (ws) => {
  ws.roomId = null

  ws.on('message', (raw) => {
    const data = safeJsonParse(String(raw))
    if (!data || typeof data !== 'object') return

    if (data.type === 'find-match') {
      findMatch(ws)
      return
    }

    if (data.type === 'leave') {
      leaveRoom(ws)
      removeFromQueue(ws)
      return
    }

    const roomId = ws.roomId
    if (!roomId) return

    if (data.type === 'offer' || data.type === 'answer' || data.type === 'ice-candidate') {
      broadcastToRoom(roomId, ws, data)
    }
  })

  const disconnect = () => {
    leaveRoom(ws)
    removeFromQueue(ws)
  }

  ws.on('close', disconnect)
  ws.on('error', disconnect)
})

server.listen(PORT, () => {
  console.log(`[signaling] listening on port ${PORT}`)
})
