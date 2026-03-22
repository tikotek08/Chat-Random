import http from 'node:http'
import { WebSocketServer } from 'ws'

// Railway/Render/Fly set PORT; local dev often uses 3001 via SIGNALING_PORT or default.
const PORT = Number(process.env.SIGNALING_PORT ?? process.env.PORT ?? 3001)

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' })
  res.end('OK\n')
})

const wss = new WebSocketServer({ server })

/** @type {Map<string, Set<import('ws').WebSocket>>} */
const rooms = new Map()

function safeJsonParse(str) {
  try {
    return JSON.parse(str)
  } catch {
    return null
  }
}

function broadcastToRoom(roomId, sender, payload) {
  const peers = rooms.get(roomId)
  if (!peers) return
  const msg = JSON.stringify(payload)
  for (const ws of peers) {
    if (ws !== sender && ws.readyState === ws.OPEN) ws.send(msg)
  }
}

wss.on('connection', (ws) => {
  ws.roomId = null

  ws.on('message', (raw) => {
    const data = safeJsonParse(String(raw))
    if (!data || typeof data !== 'object') return

    if (data.type === 'join' && typeof data.roomId === 'string' && data.roomId.trim()) {
      const roomId = data.roomId.trim()
      ws.roomId = roomId
      if (!rooms.has(roomId)) rooms.set(roomId, new Set())
      rooms.get(roomId).add(ws)

      const count = rooms.get(roomId).size
      ws.send(JSON.stringify({ type: 'joined', roomId, peers: Math.max(0, count - 1) }))
      broadcastToRoom(roomId, ws, { type: 'peer-joined' })
      return
    }

    const roomId = ws.roomId
    if (!roomId) return

    if (data.type === 'leave') {
      ws.close()
      return
    }

    // Offer/answer/ice/pass-through
    if (data.type === 'offer' || data.type === 'answer' || data.type === 'ice-candidate') {
      broadcastToRoom(roomId, ws, data)
    }
  })

  ws.on('close', () => {
    const roomId = ws.roomId
    if (!roomId) return
    const peers = rooms.get(roomId)
    if (!peers) return
    peers.delete(ws)
    if (peers.size === 0) rooms.delete(roomId)
    else broadcastToRoom(roomId, ws, { type: 'peer-left' })
  })
})

server.listen(PORT, () => {
  console.log(`[signaling] listening on port ${PORT}`)
})

