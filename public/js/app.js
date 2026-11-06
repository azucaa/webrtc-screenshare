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
    const dot = document.getElementById('serverStatusDot');
    if (dot) dot.className = 'status-indicator online';
    const text = document.getElementById('serverStatusText');
    if (text) text.textContent = 'Terhubung';
  };

  ws.onclose = () => {
    const dot = document.getElementById('serverStatusDot');
    if (dot) dot.className = 'status-indicator';
    const text = document.getElementById('serverStatusText');
    if (text) text.textContent = 'Terputus';
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
function preferH264Codec(pc) {
  if (typeof RTCRtpSender.getCapabilities !== 'function') return;
  const capabilities = RTCRtpSender.getCapabilities('video');
  if (!capabilities || !capabilities.codecs) return;

  const h264 = [];
  const others = [];
  for (const c of capabilities.codecs) {
    if (c.mimeType.toLowerCase() === 'video/h264') {
      h264.push(c);
    } else {
      others.push(c);
    }
  }
  const preferred = [...h264, ...others];

  pc.getTransceivers().forEach((transceiver) => {
    if (transceiver.sender && transceiver.sender.track && transceiver.sender.track.kind === 'video') {
      if (typeof transceiver.setCodecPreferences === 'function') {
        try {
          transceiver.setCodecPreferences(preferred);
        } catch (e) {
          console.warn('Could not set codec preference:', e);
        }
      }
    }
  });
}

function tuneSdpBitrate(sdp, bitrateKbps) {
  const lines = sdp.split('\r\n');
  const newLines = [];
  for (let line of lines) {
    newLines.push(line);
    if (line.startsWith('m=video')) {
      newLines.push(`b=AS:${bitrateKbps}`);
      newLines.push(`b=TIAS:${bitrateKbps * 1000}`);
    }
  }
  return newLines.join('\r\n');
}

async function startHostSharing() {
  const withAudio = document.getElementById('optAudio').checked;
  const mode = document.getElementById('optMode') ? document.getElementById('optMode').value : 'motion';
  const resChoice = document.getElementById('optResolution') ? document.getElementById('optResolution').value : '1080p';
  const fps = parseInt(document.getElementById('optFps') ? document.getElementById('optFps').value : '60', 10) || 60;

  const videoConstraints = {
    frameRate: { ideal: fps, max: fps }
  };

  if (resChoice === '1080p') {
    videoConstraints.width = { ideal: 1920, max: 1920 };
    videoConstraints.height = { ideal: 1080, max: 1080 };
  } else if (resChoice === '720p') {
    videoConstraints.width = { ideal: 1280, max: 1280 };
    videoConstraints.height = { ideal: 720, max: 720 };
  } else {
    videoConstraints.width = { ideal: 1920 };
    videoConstraints.height = { ideal: 1080 };
  }

  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: videoConstraints,
      audio: withAudio
    });

    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      // KUNCI UTAMA FPS MULUS:
      // Browser secara default menyetel contentHint ke 'detail' untuk screenshare,
      // yang sengaja memotong FPS ke 5-10 fps saat gambar bergerak/fullscreen.
      // Menyetel ke 'motion' memaksa browser memprioritaskan 60/30 FPS lancar!
      if ('contentHint' in videoTrack) {
        videoTrack.contentHint = mode;
      }

      videoTrack.onended = () => {
        stopHostSharing();
      };
    }

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

  const mode = document.getElementById('optMode') ? document.getElementById('optMode').value : 'motion';
  const fps = parseInt(document.getElementById('optFps') ? document.getElementById('optFps').value : '60', 10) || 60;
  const useH264 = document.getElementById('optHardwareAccel') ? document.getElementById('optHardwareAccel').checked : true;

  // Add local video/audio tracks
  let videoSender = null;
  if (localStream) {
    localStream.getTracks().forEach((track) => {
      const sender = pc.addTrack(track, localStream);
      if (track.kind === 'video') {
        videoSender = sender;
      }
    });
  }

  // Prefer H.264 Hardware Acceleration if supported
  if (useH264) {
    preferH264Codec(pc);
  }

  // Apply sender parameters (framerate & bitrate optimization)
  if (videoSender) {
    try {
      const params = videoSender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      const bitrateBps = (fps === 60 ? 6000 : 4000) * 1000;
      params.encodings[0].maxBitrate = bitrateBps;
      params.encodings[0].maxFramerate = fps;
      // maintain-framerate mencegah WebRTC memotong FPS jadi patah-patah
      params.degradationPreference = (mode === 'motion') ? 'maintain-framerate' : 'maintain-resolution';
      await videoSender.setParameters(params);
    } catch (e) {
      console.warn('Sender parameter adjustment error:', e);
    }
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

  // Create Offer with tuned SDP for high bitrate
  const offer = await pc.createOffer();
  const tunedSdp = tuneSdpBitrate(offer.sdp, fps === 60 ? 6000 : 4000);
  await pc.setLocalDescription(new RTCSessionDescription({ type: 'offer', sdp: tunedSdp }));

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
  if (!video) return;
  video.muted = !video.muted;
  const btn = document.getElementById('btnAudioToggle');
  if (btn) {
    if (video.muted) {
      btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>`;
      showToast('Suara dibisukan');
    } else {
      btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`;
      showToast('Suara aktif');
    }
  }
}

function toggleViewerChatDrawer() {
  const drawer = document.getElementById('viewerChatDrawer');
  if (!drawer) return;
  drawer.style.display = drawer.style.display === 'none' ? 'flex' : 'none';
}

function sendChat(role) {
  const input = document.getElementById(role === 'host' ? 'hostChatInput' : 'viewerChatInput');
  if (!input) return;
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
          const pill = document.getElementById('viewerStatsPill');
          if (pill) {
            pill.textContent = `${width}x${height} @ ${Math.round(fps)} FPS`;
          }
        }
      }
    });
  }, 2000);
}

function copyShareLink() {
  if (!activeRoomId) return;
  const link = `${window.location.origin}/?room=${activeRoomId}`;
  navigator.clipboard.writeText(link).then(() => {
    showToast('Tautan berhasil disalin ke papan klip');
  });
}

function switchTab(mode) {
  const isHost = mode === 'host';
  const hostBtn = document.getElementById('tabHostBtn');
  const viewerBtn = document.getElementById('tabViewerBtn');
  
  if (hostBtn) {
    hostBtn.className = isHost ? 'segment-btn active' : 'segment-btn';
    hostBtn.setAttribute('aria-selected', isHost ? 'true' : 'false');
  }
  if (viewerBtn) {
    viewerBtn.className = !isHost ? 'segment-btn active' : 'segment-btn';
    viewerBtn.setAttribute('aria-selected', !isHost ? 'true' : 'false');
  }

  const hostSec = document.getElementById('hostSection');
  const viewerSec = document.getElementById('viewerSection');
  if (hostSec) hostSec.style.display = isHost ? 'block' : 'none';
  if (viewerSec) viewerSec.style.display = !isHost ? 'block' : 'none';
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
