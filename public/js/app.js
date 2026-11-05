// ScreenCast - WebRTC Screen Sharing & Remote Control Architecture
let ws = null;
let currentRole = null; // 'host' or 'viewer'
let activeRoomId = null;

// Host state
let localStream = null;
const peerConnections = new Map(); // viewerId -> RTCPeerConnection

// Viewer state
let viewerPeerConnection = null;

// Public STUN servers for NAT traversal over internet
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

// Auto initialize based on URL params
window.addEventListener('DOMContentLoaded', () => {
  initWebSocket();
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');
  if (roomParam) {
    switchTab('viewer');
    document.getElementById('inputRoomCode').value = roomParam.toUpperCase();
    setTimeout(() => joinRoomByInput(), 400);
  }
});

/* ========================================================
 * 1. WebSocket Signaling Connection
 * ======================================================== */
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    document.getElementById('serverStatusDot').className = 'status-dot online';
    document.getElementById('serverStatusText').textContent = 'Server Online';
  };

  ws.onclose = () => {
    document.getElementById('serverStatusDot').className = 'status-dot';
    document.getElementById('serverStatusText').textContent = 'Terputus (Mencoba ulang...)';
    setTimeout(initWebSocket, 2000);
  };

  ws.onmessage = async (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch (e) {
      return;
    }

    switch (data.type) {
      // HOST handlers
      case 'room-created':
        handleRoomCreated(data.roomId);
        break;

      case 'viewer-joined':
        handleViewerJoined(data.viewerId, data.totalViewers);
        break;

      case 'viewer-left':
        handleViewerLeft(data.viewerId, data.totalViewers);
        break;

      // VIEWER handlers
      case 'joined-room':
        handleJoinedRoom(data.roomId, data.viewerId);
        break;

      case 'host-disconnected':
        showToast(data.message || 'Host telah berhenti share screen.');
        stopViewer();
        break;

      // WEBRTC SIGNALING (Offer, Answer, ICE Candidates)
      case 'signal':
        handleWebRTCSignal(data);
        break;

      case 'chat-message':
        renderChatMessage(data);
        break;

      case 'error':
        showToast(data.message, 'error');
        break;
    }
  };
}

/* ========================================================
 * 2. Host Logic (Screen Capture & Streaming)
 * ======================================================== */
async function startHostSharing() {
  const withAudio = document.getElementById('optAudio').checked;
  const is60Fps = document.getElementById('opt60fps').checked;

  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: { ideal: is60Fps ? 60 : 30, max: 60 },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: withAudio
    });

    // Detect if user clicks "Stop Sharing" on browser floating bar
    localStream.getVideoTracks()[0].onended = () => {
      stopHostSharing();
    };

    currentRole = 'host';
    document.getElementById('hostPreviewVideo').srcObject = localStream;

    // Send create-room to signaling server
    ws.send(JSON.stringify({ type: 'create-room' }));

  } catch (err) {
    console.error('Gagal mengambil layar:', err);
    showToast('Gagal membagikan layar: ' + (err.message || 'Izin ditolak'));
  }
}

function handleRoomCreated(roomId) {
  activeRoomId = roomId;
  document.getElementById('hostSetupCard').style.display = 'none';
  document.getElementById('hostActiveDash').style.display = 'grid';
  document.getElementById('displayRoomCode').textContent = roomId;

  // Generate dynamic QR Code for mobile
  const joinUrl = `${window.location.origin}/?room=${roomId}`;
  const qrContainer = document.getElementById('qrcodeBox');
  qrContainer.innerHTML = '';
  new QRCode(qrContainer, {
    text: joinUrl,
    width: 140,
    height: 140,
    colorDark: '#0a0e17',
    colorLight: '#ffffff'
  });

  showToast(`Room ${roomId} aktif! Silakan bagikan link.`);
}

async function handleViewerJoined(viewerId, totalViewers) {
  document.getElementById('hostViewerCount').textContent = `${totalViewers} Penonton`;
  showToast(`Penonton baru bergabung (${viewerId.slice(-4)})`);

  // Create new RTCPeerConnection for this viewer
  const pc = new RTCPeerConnection(rtcConfig);
  peerConnections.set(viewerId, pc);

  // Add local video/audio tracks
  if (localStream) {
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
  }

  // ICE Candidates
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      ws.send(JSON.stringify({
        type: 'signal',
        targetViewerId: viewerId,
        signal: { candidate: event.candidate }
      }));
    }
  };

  // Create Offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  ws.send(JSON.stringify({
    type: 'signal',
    targetViewerId: viewerId,
    signal: { sdp: pc.localDescription }
  }));
}

function handleViewerLeft(viewerId, totalViewers) {
  document.getElementById('hostViewerCount').textContent = `${totalViewers} Penonton`;
  const pc = peerConnections.get(viewerId);
  if (pc) {
    pc.close();
    peerConnections.delete(viewerId);
  }
}

function stopHostSharing() {
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  peerConnections.forEach((pc) => pc.close());
  peerConnections.clear();

  document.getElementById('hostActiveDash').style.display = 'none';
  document.getElementById('hostSetupCard').style.display = 'block';
  document.getElementById('hostPreviewVideo').srcObject = null;
  activeRoomId = null;
  currentRole = null;
  showToast('Screen sharing dihentikan.');
}

/* ========================================================
 * 3. Viewer Logic (Watching & Stats)
 * ======================================================== */
function joinRoomByInput() {
  const code = document.getElementById('inputRoomCode').value.trim().toUpperCase();
  if (code.length < 4) {
    showToast('Masukkan kode room yang valid.', 'error');
    return;
  }
  currentRole = 'viewer';
  activeRoomId = code;

  ws.send(JSON.stringify({
    type: 'join-room',
    roomId: code
  }));
}

function handleJoinedRoom(roomId, viewerId) {
  document.getElementById('viewerJoinCard').style.display = 'none';
  document.getElementById('viewerActiveScreen').style.display = 'flex';
  document.getElementById('tabsBar').style.display = 'none'; // Hide tabs for focused view

  viewerPeerConnection = new RTCPeerConnection(rtcConfig);

  viewerPeerConnection.ontrack = (event) => {
    const video = document.getElementById('viewerVideo');
    if (video.srcObject !== event.streams[0]) {
      video.srcObject = event.streams[0];
      video.play().catch(() => {});
      document.getElementById('viewerStatsPill').textContent = 'Stream Aktif (Terhubung)';
      startStatsMonitor(viewerPeerConnection);
    }
  };

  viewerPeerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      ws.send(JSON.stringify({
        type: 'signal',
        signal: { candidate: event.candidate }
      }));
    }
  };

  showToast(`Berhasil masuk ke Room ${roomId}!`);
}

function stopViewer() {
  if (viewerPeerConnection) {
    viewerPeerConnection.close();
    viewerPeerConnection = null;
  }
  document.getElementById('viewerActiveScreen').style.display = 'none';
  document.getElementById('viewerJoinCard').style.display = 'block';
  document.getElementById('tabsBar').style.display = 'flex';
  document.getElementById('viewerVideo').srcObject = null;
}

/* ========================================================
 * 4. WebRTC Signaling Dispatcher
 * ======================================================== */
async function handleWebRTCSignal(data) {
  if (currentRole === 'host') {
    const pc = peerConnections.get(data.fromViewerId);
    if (!pc) return;

    if (data.signal.sdp) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.signal.sdp));
    } else if (data.signal.candidate) {
      await pc.addIceCandidate(new RTCIceCandidate(data.signal.candidate));
    }
  } else if (currentRole === 'viewer') {
    if (!viewerPeerConnection) return;

    if (data.signal.sdp) {
      await viewerPeerConnection.setRemoteDescription(new RTCSessionDescription(data.signal.sdp));
      const answer = await viewerPeerConnection.createAnswer();
      await viewerPeerConnection.setLocalDescription(answer);

      ws.send(JSON.stringify({
        type: 'signal',
        signal: { sdp: viewerPeerConnection.localDescription }
      }));
    } else if (data.signal.candidate) {
      await viewerPeerConnection.addIceCandidate(new RTCIceCandidate(data.signal.candidate));
    }
  }
}

/* ========================================================
 * 5. Controls & Features (Fullscreen, Audio, Chat, Stats)
 * ======================================================== */
function toggleFullscreen() {
  const wrap = document.getElementById('viewerPlayerWrap');
  if (!document.fullscreenElement) {
    wrap.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

function toggleViewerAudio() {
  const video = document.getElementById('viewerVideo');
  video.muted = !video.muted;
  document.getElementById('btnAudioToggle').textContent = video.muted ? '🔇' : '🔊';
  showToast(video.muted ? 'Suara dibisukan' : 'Suara diaktifkan');
}

function toggleViewerChatDrawer() {
  const drawer = document.getElementById('viewerChatDrawer');
  drawer.style.display = drawer.style.display === 'none' ? 'flex' : 'none';
}

function sendChat(role) {
  const input = document.getElementById(role === 'host' ? 'hostChatInput' : 'viewerChatInput');
  const text = input.value.trim();
  if (!text) return;
  ws.send(JSON.stringify({ type: 'chat-message', text }));
  input.value = '';
}

function renderChatMessage(msg) {
  const container = document.getElementById(currentRole === 'host' ? 'hostChatBox' : 'viewerChatBox');
  if (!container) return;
  const item = document.createElement('div');
  item.className = 'chat-msg';
  item.innerHTML = `<span class="chat-sender">${escapeHtml(msg.sender)}:</span><span>${escapeHtml(msg.text)}</span><span class="chat-time">${msg.time}</span>`;
  container.appendChild(item);
  container.scrollTop = container.scrollHeight;
}

function startStatsMonitor(pc) {
  setInterval(async () => {
    if (!pc || pc.connectionState !== 'connected') return;
    const stats = await pc.getStats();
    stats.forEach((report) => {
      if (report.type === 'inbound-rtp' && report.kind === 'video') {
        const fps = report.framesPerSecond || 0;
        const width = report.frameWidth || 0;
        const height = report.frameHeight || 0;
        if (width > 0) {
          document.getElementById('viewerStatsPill').textContent = `${width}x${height} @ ${Math.round(fps)} FPS`;
        }
      }
    });
  }, 2000);
}

function copyShareLink() {
  if (!activeRoomId) return;
  const link = `${window.location.origin}/?room=${activeRoomId}`;
  navigator.clipboard.writeText(link).then(() => {
    showToast('Link berhasil disalin ke clipboard!');
  });
}

function switchTab(mode) {
  const isHost = mode === 'host';
  document.getElementById('tabHostBtn').className = isHost ? 'tab-btn active' : 'tab-btn';
  document.getElementById('tabViewerBtn').className = !isHost ? 'tab-btn active' : 'tab-btn';
  document.getElementById('hostSection').style.display = isHost ? 'block' : 'none';
  document.getElementById('viewerSection').style.display = !isHost ? 'block' : 'none';
}

function showToast(text, type = 'info') {
  const container = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  container.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 300);
  }, 3500);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
