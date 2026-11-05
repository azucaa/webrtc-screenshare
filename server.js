const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const { WebSocketServer, WebSocket } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Simple API to get network IPs
app.get('/api/info', (req, res) => {
  res.json({
    localIp: getLocalIp(),
    port: PORT,
  });
});

// Room state: roomId -> { hostWs, viewers: Map<viewerId, viewerWs> }
const rooms = new Map();

function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

wss.on('connection', (ws) => {
  let userRole = null;
  let currentRoomId = null;
  let viewerId = null;

  ws.on('message', (message) => {
    let data;
    try {
      data = JSON.parse(message);
    } catch (e) {
      return;
    }

    const { type, roomId } = data;

    switch (type) {
      case 'create-room': {
        const newRoomId = generateRoomId();
        userRole = 'host';
        currentRoomId = newRoomId;

        rooms.set(newRoomId, {
          hostWs: ws,
          viewers: new Map(),
          createdAt: Date.now()
        });

        ws.send(JSON.stringify({
          type: 'room-created',
          roomId: newRoomId
        }));
        console.log(`[Room Created] Room ID: ${newRoomId}`);
        break;
      }

      case 'join-room': {
        const targetRoom = rooms.get(roomId);
        if (!targetRoom || !targetRoom.hostWs || targetRoom.hostWs.readyState !== WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Room tidak ditemukan atau Host sudah tidak aktif.'
          }));
          return;
        }

        userRole = 'viewer';
        currentRoomId = roomId;
        viewerId = 'v_' + Math.random().toString(36).substring(2, 9);

        targetRoom.viewers.set(viewerId, ws);

        ws.send(JSON.stringify({
          type: 'joined-room',
          roomId,
          viewerId
        }));

        // Notify Host that a new viewer joined so Host initiates WebRTC Offer
        targetRoom.hostWs.send(JSON.stringify({
          type: 'viewer-joined',
          viewerId,
          totalViewers: targetRoom.viewers.size
        }));

        console.log(`[Viewer Joined] ${viewerId} joined ${roomId}. Total: ${targetRoom.viewers.size}`);
        break;
      }

      case 'signal': {
        // Forward WebRTC signals (offer, answer, ice-candidate)
        const targetRoom = rooms.get(currentRoomId);
        if (!targetRoom) return;

        if (userRole === 'host') {
          // Host sends offer or candidate to a specific viewer
          const targetViewerWs = targetRoom.viewers.get(data.targetViewerId);
          if (targetViewerWs && targetViewerWs.readyState === WebSocket.OPEN) {
            targetViewerWs.send(JSON.stringify({
              type: 'signal',
              signal: data.signal,
              from: 'host'
            }));
          }
        } else if (userRole === 'viewer') {
          // Viewer sends answer or candidate back to host
          if (targetRoom.hostWs && targetRoom.hostWs.readyState === WebSocket.OPEN) {
            targetRoom.hostWs.send(JSON.stringify({
              type: 'signal',
              signal: data.signal,
              fromViewerId: viewerId
            }));
          }
        }
        break;
      }

      case 'control-event': {
        // Ready for future remote control extension (mouse click, scroll, keydown)
        const targetRoom = rooms.get(currentRoomId);
        if (targetRoom && targetRoom.hostWs && targetRoom.hostWs.readyState === WebSocket.OPEN) {
          targetRoom.hostWs.send(JSON.stringify({
            type: 'control-event',
            fromViewerId: viewerId,
            event: data.event
          }));
        }
        break;
      }

      case 'chat-message': {
        const targetRoom = rooms.get(currentRoomId);
        if (!targetRoom) return;
        const chatPayload = JSON.stringify({
          type: 'chat-message',
          sender: userRole === 'host' ? 'Host (PC)' : `Viewer (${viewerId.slice(-4)})`,
          text: data.text,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });

        // Broadcast to host and all viewers in room
        if (targetRoom.hostWs.readyState === WebSocket.OPEN) targetRoom.hostWs.send(chatPayload);
        targetRoom.viewers.forEach((vWs) => {
          if (vWs.readyState === WebSocket.OPEN) vWs.send(chatPayload);
        });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;

    if (userRole === 'host') {
      console.log(`[Host Left] Closing room ${currentRoomId}`);
      // Notify all viewers
      room.viewers.forEach((vWs) => {
        if (vWs.readyState === WebSocket.OPEN) {
          vWs.send(JSON.stringify({
            type: 'host-disconnected',
            message: 'Host telah menghentikan screen sharing.'
          }));
        }
      });
      rooms.delete(currentRoomId);
    } else if (userRole === 'viewer' && viewerId) {
      room.viewers.delete(viewerId);
      console.log(`[Viewer Left] ${viewerId} left ${currentRoomId}. Remaining: ${room.viewers.size}`);
      if (room.hostWs && room.hostWs.readyState === WebSocket.OPEN) {
        room.hostWs.send(JSON.stringify({
          type: 'viewer-left',
          viewerId,
          totalViewers: room.viewers.size
        }));
      }
    }
  });
});

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

server.listen(PORT, '0.0.0.0', () => {
  const localIp = getLocalIp();
  console.log(`\n======================================================`);
  console.log(`🚀 WebRTC Screen Share Server running!`);
  console.log(`   - Local PC  : http://localhost:${PORT}`);
  console.log(`   - Same Wi-Fi: http://${localIp}:${PORT}`);
  console.log(`======================================================\n`);
});
