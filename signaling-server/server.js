const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3001;
const wss = new WebSocketServer({ port: PORT });

// rooms: Map<roomId, Set<WebSocket>>
const rooms = new Map();

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast(room, sender, msg) {
  for (const client of room) {
    if (client !== sender) send(client, msg);
  }
}

wss.on('connection', (ws) => {
  let currentRoom = null;

  const leaveRoom = () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (room) {
      room.delete(ws);
      if (room.size === 0) rooms.delete(currentRoom);
      else broadcast(room, ws, { type: 'peer-left' });
    }
    currentRoom = null;
  };

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(String(data)); } catch { return; }

    if (msg.type === 'join') {
      leaveRoom();
      const roomId = String(msg.roomId || '').toUpperCase().trim();
      if (!roomId) return;

      currentRoom = roomId;
      if (!rooms.has(roomId)) rooms.set(roomId, new Set());
      const room = rooms.get(roomId);
      const peers = room.size;
      room.add(ws);

      send(ws, { type: 'joined', roomId, peers });
      broadcast(room, ws, { type: 'peer-joined' });
      return;
    }

    if (msg.type === 'leave') { leaveRoom(); return; }

    if (!currentRoom || !rooms.has(currentRoom)) return;
    const room = rooms.get(currentRoom);

    if (msg.type === 'offer')         broadcast(room, ws, { type: 'offer', sdp: msg.sdp });
    else if (msg.type === 'answer')   broadcast(room, ws, { type: 'answer', sdp: msg.sdp });
    else if (msg.type === 'ice-candidate') broadcast(room, ws, { type: 'ice-candidate', candidate: msg.candidate });
  });

  ws.on('close', leaveRoom);
  ws.on('error', leaveRoom);
});

console.log(`Signaling server listening on port ${PORT}`);
