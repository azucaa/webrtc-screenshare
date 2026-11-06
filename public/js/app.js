// ScreenCast - WebRTC Screen Sharing & Remote Control Architecture
let ws = null;
let currentRole = null; // 'host' or 'viewer'
let activeRoomId = null;

// Host state
let localStream = null;
const peerConnections = new Map(); // viewerId -> RTCPeerConnection

// Viewer state
let viewerPeerConnection = null;

// Facecam & Mic state
let localCamStream = null;
let localMicStream = null;
let isFacecamActive = false;
let isMicActive = false;
let currentCamFacingMode = 'user'; // 'user' or 'environment'
let partnerCamTrackId = null;

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
  renderRecentRooms();
  initKeyboardShortcuts();

  const playerWrap = document.getElementById('viewerPlayerWrap');
  if (playerWrap) {
    playerWrap.addEventListener('mousemove', () => showHud(3500));
  }

  // Initialize draggable facecam bubbles
  ['partnerFacecamBubble', 'selfFacecamBubble', 'hostPartnerBubble', 'hostSelfBubble'].forEach(id => {
    const el = document.getElementById(id);
    if (el) makeDraggable(el);
  });

  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');
  if (roomParam) {
    switchTab('viewer');
    const input = document.getElementById('inputRoomCode');
    if (input) {
      input.value = roomParam.toUpperCase();
      updateOtpSlots();
    }
    setTimeout(() => joinRoomByInput(), 400);
  } else {
    updateOtpSlots();
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

      case 'facecam-status':
        handleFacecamStatus(data);
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
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isIOS) {
    showToast('Apple membatasi siaran layar di peramban web iOS. Anda dapat menggunakan iPhone sebagai Penonton (Viewer).', 'error');
    return;
  }

  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
    showToast('Peramban ini tidak mendukung siaran layar. Gunakan Chrome di Android, PC, atau Mac.');
    return;
  }

  const isMobile = /Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const withAudio = isMobile ? false : (document.getElementById('optAudio') ? document.getElementById('optAudio').checked : false);
  const mode = document.getElementById('optMode') ? document.getElementById('optMode').value : 'motion';
  const resChoice = document.getElementById('optResolution') ? document.getElementById('optResolution').value : '1080p';
  const fps = parseInt(document.getElementById('optFps') ? document.getElementById('optFps').value : '60', 10) || 60;

  let displayConstraints;
  if (isMobile) {
    // Android Chrome hanya menerima constraint sederhana dan menolak audio capture
    displayConstraints = {
      video: true,
      audio: false
    };
  } else {
    const isPortrait = window.innerWidth < window.innerHeight;
    const videoConstraints = {
      frameRate: { ideal: fps, max: fps }
    };

    if (resChoice === '1080p') {
      videoConstraints.width = { ideal: isPortrait ? 1080 : 1920 };
      videoConstraints.height = { ideal: isPortrait ? 1920 : 1080 };
    } else if (resChoice === '720p') {
      videoConstraints.width = { ideal: isPortrait ? 720 : 1280 };
      videoConstraints.height = { ideal: isPortrait ? 1280 : 720 };
    }

    displayConstraints = {
      video: videoConstraints,
      audio: withAudio
    };
  }

  try {
    try {
      localStream = await navigator.mediaDevices.getDisplayMedia(displayConstraints);
    } catch (captureErr) {
      if (withAudio) {
        console.warn('Audio capture failed, retrying video only:', captureErr);
        displayConstraints.audio = false;
        localStream = await navigator.mediaDevices.getDisplayMedia(displayConstraints);
      } else {
        throw captureErr;
      }
    }

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

  // Direct Clickable URL & Button to open in new tab
  const joinUrl = `${window.location.origin}/?room=${roomId}`;
  const directLinkEl = document.getElementById('roomDirectLink');
  if (directLinkEl) {
    directLinkEl.href = joinUrl;
    directLinkEl.textContent = joinUrl;
  }
  const btnOpenTab = document.getElementById('btnOpenRoomTab');
  if (btnOpenTab) {
    btnOpenTab.href = joinUrl;
  }

  // Generate dynamic QR Code for mobile
  const qrContainer = document.getElementById('qrcodeBox');
  if (qrContainer) {
    qrContainer.innerHTML = '';
    new QRCode(qrContainer, {
      text: joinUrl,
      width: 140,
      height: 140,
      colorDark: '#0a0e17',
      colorLight: '#ffffff'
    });
  }

  showToast(`Ruang ${roomId} aktif! Tautan langsung telah disiapkan.`);
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

  // If Host has active Facecam or Mic, also stream them to this viewer
  if (localCamStream) {
    localCamStream.getTracks().forEach((track) => {
      pc.addTrack(track, localCamStream);
    });
  }
  if (localMicStream) {
    localMicStream.getTracks().forEach((track) => {
      pc.addTrack(track, localMicStream);
    });
  }

  // Handle incoming streams from viewer (e.g. viewer's facecam/mic)
  pc.ontrack = (event) => {
    if (event.track.kind === 'video') {
      const partnerVideo = document.getElementById('hostPartnerCamVideo');
      const partnerBubble = document.getElementById('hostPartnerBubble');
      if (partnerVideo) {
        partnerVideo.srcObject = event.streams[0] || new MediaStream([event.track]);
      }
      if (partnerBubble) {
        partnerBubble.style.display = 'flex';
      }
    } else if (event.track.kind === 'audio') {
      const audioEl = new Audio();
      const stream = event.streams[0] || new MediaStream([event.track]);
      audioEl.srcObject = stream;
      audioEl.play().catch(() => {});
      startVoiceActivityDetection(stream, 'hostPartnerBubble');
    }
  };

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
  stopAllVoiceActivityDetection();
  stopFacecam();
  if (localMicStream) {
    localMicStream.getTracks().forEach((t) => t.stop());
    localMicStream = null;
  }
  isMicActive = false;
  updateMicButtonsUI(false);

  const hostPartnerVideo = document.getElementById('hostPartnerCamVideo');
  if (hostPartnerVideo) hostPartnerVideo.srcObject = null;
  const hostPartnerBubble = document.getElementById('hostPartnerBubble');
  if (hostPartnerBubble) hostPartnerBubble.style.display = 'none';

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
 * 3. Viewer Logic (Watching & Controls)
 * ======================================================== */
function updateOtpSlots() {
  const input = document.getElementById('inputRoomCode');
  if (!input) return;
  const raw = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (input.value !== raw) {
    input.value = raw;
  }
  const val = raw;
  const slots = document.querySelectorAll('.otp-slot');
  const isFocused = (document.activeElement === input);

  slots.forEach((slot, index) => {
    const char = val[index] || '';
    const charEl = slot.querySelector('.otp-val');
    if (charEl) charEl.textContent = char;

    slot.classList.toggle('is-filled', !!char);
    slot.classList.toggle('is-empty', !char);

    // Active slot: currently editing index, or last slot if full
    const isActive = isFocused && (index === val.length || (val.length === 6 && index === 5));
    slot.classList.toggle('is-active', isActive);
  });
}

function focusOtpInput() {
  const input = document.getElementById('inputRoomCode');
  if (input) {
    input.focus();
    updateOtpSlots();
  }
}

async function pasteRoomCode() {
  try {
    const text = await navigator.clipboard.readText();
    const clean = text.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (clean) {
      const input = document.getElementById('inputRoomCode');
      if (input) {
        input.value = clean;
        updateOtpSlots();
        showToast('Kode ditempel: ' + clean);
        if (clean.length === 6) {
          setTimeout(() => joinRoomByInput(), 200);
        }
      }
    }
  } catch (err) {
    showToast('Izinkan akses clipboard atau ketik kode manual');
  }
}

function saveRecentRoom(roomId) {
  try {
    let recent = JSON.parse(localStorage.getItem('screencast_recent') || '[]');
    recent = recent.filter(r => r !== roomId);
    recent.unshift(roomId);
    if (recent.length > 4) recent = recent.slice(0, 4);
    localStorage.setItem('screencast_recent', JSON.stringify(recent));
    renderRecentRooms();
  } catch (e) {}
}

function renderRecentRooms() {
  const box = document.getElementById('viewerRecentRooms');
  const list = document.getElementById('recentRoomsList');
  if (!box || !list) return;

  try {
    const recent = JSON.parse(localStorage.getItem('screencast_recent') || '[]');
    if (recent.length === 0) {
      box.style.display = 'none';
      return;
    }
    box.style.display = 'block';
    list.innerHTML = '';
    recent.forEach(code => {
      const chip = document.createElement('button');
      chip.className = 'recent-room-chip';
      chip.textContent = code;
      chip.onclick = () => {
        const input = document.getElementById('inputRoomCode');
        if (input) {
          input.value = code;
          updateOtpSlots();
        }
        joinRoomByInput();
      };
      list.appendChild(chip);
    });
  } catch (e) {}
}

function joinRoomByInput() {
  const code = document.getElementById('inputRoomCode').value.trim().toUpperCase();
  if (code.length < 4) {
    showToast('Masukkan kode ruang yang valid.');
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
  saveRecentRoom(roomId);
  document.body.classList.add('is-watching');

  const roomDisplay = document.getElementById('viewerCurrentRoom');
  if (roomDisplay) roomDisplay.textContent = 'RUANG: ' + roomId;

  document.getElementById('viewerJoinCard').style.display = 'none';
  document.getElementById('viewerActiveScreen').style.display = 'flex';
  document.getElementById('tabsBar').style.display = 'none'; // Fokus penuh ke siaran

  viewerPeerConnection = new RTCPeerConnection(rtcConfig);

  // If Viewer has active Facecam or Mic, add tracks
  if (localCamStream) {
    localCamStream.getTracks().forEach((track) => {
      viewerPeerConnection.addTrack(track, localCamStream);
    });
  }
  if (localMicStream) {
    localMicStream.getTracks().forEach((track) => {
      viewerPeerConnection.addTrack(track, localMicStream);
    });
  }

  viewerPeerConnection.ontrack = (event) => {
    const video = document.getElementById('viewerVideo');
    const isScreenSet = video.srcObject && video.srcObject.getVideoTracks && video.srcObject.getVideoTracks().length > 0;

    if (event.track.kind === 'video') {
      if (!isScreenSet) {
        // First video track received is Screen Share
        video.srcObject = event.streams[0] || new MediaStream([event.track]);
        video.muted = true; // Wajib dimatikan suaranya di awal agar diizinkan Autoplay oleh iOS & Android
        
        const playPromise = video.play();
        if (playPromise !== undefined) {
          playPromise.catch((err) => {
            console.warn('Autoplay tertahan kebijakan browser, butuh interaksi pengguna:', err);
            const statPill = document.getElementById('viewerStatsPill');
            if (statPill) statPill.textContent = 'Ketuk video untuk memulai siaran';
            
            const startPlaybackOnTap = () => {
              video.play().catch(() => {});
              if (statPill) statPill.textContent = 'Stream Aktif (Terhubung)';
              document.removeEventListener('click', startPlaybackOnTap);
            };
            document.addEventListener('click', startPlaybackOnTap, { once: true });
          });
        }
        
        document.getElementById('viewerStatsPill').textContent = 'Stream Aktif (Terhubung)';
        startStatsMonitor(viewerPeerConnection);
      } else {
        // Second video track received is Partner's Facecam
        const partnerVideo = document.getElementById('partnerFacecamVideo');
        const partnerBubble = document.getElementById('partnerFacecamBubble');
        if (partnerVideo) {
          partnerVideo.srcObject = event.streams[0] || new MediaStream([event.track]);
          partnerVideo.play().catch(() => {});
        }
        if (partnerBubble) {
          partnerBubble.style.display = 'flex';
        }
      }
    } else if (event.track.kind === 'audio') {
      // If mic track from partner, play through an Audio element
      if (video.srcObject && event.streams[0] && video.srcObject.id !== event.streams[0].id) {
        const audioEl = new Audio();
        const stream = event.streams[0] || new MediaStream([event.track]);
        audioEl.srcObject = stream;
        audioEl.play().catch(() => {});
        startVoiceActivityDetection(stream, 'partnerFacecamBubble');
      }
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

  showToast(`Tersambung ke Ruang ${roomId}`);
  showHud(4000);
}

function stopViewer() {
  stopAllVoiceActivityDetection();
  document.body.classList.remove('is-watching');
  stopFacecam();
  if (localMicStream) {
    localMicStream.getTracks().forEach((t) => t.stop());
    localMicStream = null;
  }
  isMicActive = false;
  updateMicButtonsUI(false);

  const partnerVideo = document.getElementById('partnerFacecamVideo');
  if (partnerVideo) partnerVideo.srcObject = null;
  const partnerBubble = document.getElementById('partnerFacecamBubble');
  if (partnerBubble) partnerBubble.style.display = 'none';

  if (viewerPeerConnection) {
    viewerPeerConnection.close();
    viewerPeerConnection = null;
  }
  document.getElementById('viewerActiveScreen').style.display = 'none';
  document.getElementById('viewerJoinCard').style.display = 'block';
  document.getElementById('tabsBar').style.display = 'flex';
  document.getElementById('viewerVideo').srcObject = null;
  currentRole = null;
  activeRoomId = null;
  showToast('Siaran telah dihentikan.');
}

let viewerFitMode = 'contain';
function toggleViewerFit() {
  const video = document.getElementById('viewerVideo');
  if (!video) return;

  if (viewerFitMode === 'contain') {
    viewerFitMode = 'cover';
    video.style.objectFit = 'cover';
    showToast('Tampilan: Penuh (Zoom tanpa bingkai)');
  } else if (viewerFitMode === 'cover') {
    viewerFitMode = 'fill';
    video.style.objectFit = 'fill';
    showToast('Tampilan: Rentang Penuh (Stretch)');
  } else {
    viewerFitMode = 'contain';
    video.style.objectFit = 'contain';
    showToast('Tampilan: Pas Asli (Contain)');
  }
}

async function toggleViewerPiP() {
  const video = document.getElementById('viewerVideo');
  if (!video) return;
  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    } else if (document.pictureInPictureEnabled) {
      await video.requestPictureInPicture();
    } else {
      showToast('Picture-in-Picture tidak didukung di peramban ini');
    }
  } catch (err) {
    console.warn('PiP error:', err);
  }
}

let lastPlayerTapTime = 0;
let singleTapTimer = null;
let hudTimer = null;
let isHudVisible = true;

function showHud(autoHideMs = 4000) {
  const top = document.getElementById('playerTopBar');
  const bottom = document.getElementById('playerBottomHud');
  if (!top || !bottom) return;

  top.classList.remove('hud-hidden');
  bottom.classList.remove('hud-hidden');
  isHudVisible = true;

  clearTimeout(hudTimer);
  if (autoHideMs > 0) {
    hudTimer = setTimeout(() => {
      hideHud();
    }, autoHideMs);
  }
}

function hideHud() {
  const top = document.getElementById('playerTopBar');
  const bottom = document.getElementById('playerBottomHud');
  if (!top || !bottom) return;

  top.classList.add('hud-hidden');
  bottom.classList.add('hud-hidden');
  isHudVisible = false;
  clearTimeout(hudTimer);
}

function toggleHud() {
  if (isHudVisible) {
    hideHud();
  } else {
    showHud(4000);
  }
}

function handlePlayerTap(e) {
  if (e && e.target && (e.target.closest('#playerTopBar') || e.target.closest('#playerBottomHud'))) {
    showHud(4000);
    return;
  }

  const now = Date.now();
  const timeSinceLast = now - lastPlayerTapTime;

  if (timeSinceLast < 320 && timeSinceLast > 0) {
    clearTimeout(singleTapTimer);
    singleTapTimer = null;
    lastPlayerTapTime = 0;
    toggleViewerFit();
    showHud(2500);
  } else {
    lastPlayerTapTime = now;
    clearTimeout(singleTapTimer);
    singleTapTimer = setTimeout(() => {
      toggleHud();
      singleTapTimer = null;
    }, 250);
  }
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
      // If viewer sent an offer (renegotiation for facecam), host creates and sends answer
      if (data.signal.sdp.type === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ws.send(JSON.stringify({
          type: 'signal',
          targetViewerId: data.fromViewerId,
          signal: { sdp: pc.localDescription }
        }));
      }
    } else if (data.signal.candidate) {
      await pc.addIceCandidate(new RTCIceCandidate(data.signal.candidate));
    }
  } else if (currentRole === 'viewer') {
    if (!viewerPeerConnection) return;

    if (data.signal.sdp) {
      await viewerPeerConnection.setRemoteDescription(new RTCSessionDescription(data.signal.sdp));
      if (data.signal.sdp.type === 'offer') {
        const answer = await viewerPeerConnection.createAnswer();
        await viewerPeerConnection.setLocalDescription(answer);

        ws.send(JSON.stringify({
          type: 'signal',
          signal: { sdp: viewerPeerConnection.localDescription }
        }));
      }
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
  const video = document.getElementById('viewerVideo');
  if (!wrap) return;

  const isFs = document.fullscreenElement || document.webkitFullscreenElement || wrap.classList.contains('is-fullscreen');

  if (isFs) {
    if (document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
    wrap.classList.remove('is-fullscreen');
  } else {
    if (wrap.requestFullscreen) {
      wrap.requestFullscreen().catch(() => {
        if (video && video.webkitEnterFullscreen) {
          video.webkitEnterFullscreen();
        } else {
          wrap.classList.add('is-fullscreen');
        }
      });
    } else if (wrap.webkitRequestFullscreen) {
      wrap.webkitRequestFullscreen();
    } else if (video && video.webkitEnterFullscreen) {
      video.webkitEnterFullscreen();
    } else {
      wrap.classList.add('is-fullscreen');
    }
  }
}

document.addEventListener('fullscreenchange', handleFullscreenStateChange);
document.addEventListener('webkitfullscreenchange', handleFullscreenStateChange);

function handleFullscreenStateChange() {
  const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
  const wrap = document.getElementById('viewerPlayerWrap');
  if (wrap) {
    if (isFs) {
      wrap.classList.add('is-fullscreen');
    } else {
      wrap.classList.remove('is-fullscreen');
    }
  }
  showHud(4000);
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
  const senderName = msg.sender || 'Pesan';
  const isHostSender = senderName.toLowerCase().includes('host');
  const badgeClass = isHostSender ? 'host' : 'viewer';
  const badgeLabel = isHostSender ? 'Host' : 'Viewer';

  item.innerHTML = `
    <div class="chat-msg-header">
      <span class="sender-badge ${badgeClass}">${escapeHtml(badgeLabel)}</span>
      <span class="chat-time">${escapeHtml(msg.time || '')}</span>
    </div>
    <div class="chat-msg-text">${escapeHtml(msg.text || '')}</div>
  `;
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
  document.body.classList.remove('is-watching');
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

/* ========================================================
 * 6. Simplified Controls: Mic, Camera & Dragging
 * ======================================================== */
async function toggleSelfMic() {
  if (!isMicActive) {
    // Nyalakan Mikrofon
    if (!localMicStream) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showToast('Peramban ini tidak mendukung akses mikrofon.', 'error');
        return;
      }
      try {
        localMicStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        console.error('Akses mic gagal:', err);
        showToast('Gagal mengakses mikrofon: ' + (err.message || 'Izin ditolak'), 'error');
        return;
      }

      const audioTrack = localMicStream.getAudioTracks()[0];
      if (currentRole === 'viewer' && viewerPeerConnection) {
        viewerPeerConnection.addTrack(audioTrack, localMicStream);
        try {
          const offer = await viewerPeerConnection.createOffer();
          await viewerPeerConnection.setLocalDescription(offer);
          ws.send(JSON.stringify({
            type: 'signal',
            signal: { sdp: viewerPeerConnection.localDescription }
          }));
        } catch (e) {
          console.warn('Renegotiate mic offer error:', e);
        }
      } else if (currentRole === 'host') {
        peerConnections.forEach(async (pc, vId) => {
          pc.addTrack(audioTrack, localMicStream);
          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            ws.send(JSON.stringify({
              type: 'signal',
              targetViewerId: vId,
              signal: { sdp: pc.localDescription }
            }));
          } catch (e) {}
        });
      }
    } else {
      localMicStream.getAudioTracks().forEach(t => t.enabled = true);
    }
    isMicActive = true;
    updateMicButtonsUI(true);
    startVoiceActivityDetection(localMicStream, currentRole === 'viewer' ? 'selfFacecamBubble' : 'hostSelfBubble');
    showToast('Mikrofon aktif.');
  } else {
    // Matikan Mikrofon (Bisu)
    if (localMicStream) {
      localMicStream.getAudioTracks().forEach(t => t.enabled = false);
    }
    isMicActive = false;
    updateMicButtonsUI(false);
    stopVoiceActivityDetection('selfFacecamBubble');
    stopVoiceActivityDetection('hostSelfBubble');
    showToast('Mikrofon dibisukan.');
  }
}

function updateMicButtonsUI(isActive) {
  const viewerMicBtn = document.getElementById('btnMicToggle');
  const hostMicBtn = document.getElementById('btnHostMicToggle');
  const hostMicLabel = document.getElementById('hostMicBtnLabel');

  const unmutedSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>`;
  const mutedSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>`;

  if (viewerMicBtn) {
    if (isActive) {
      viewerMicBtn.classList.remove('is-muted');
      viewerMicBtn.classList.add('is-active');
      viewerMicBtn.innerHTML = unmutedSvg;
      viewerMicBtn.title = 'Mikrofon: Aktif (Klik untuk Bisu)';
    } else {
      viewerMicBtn.classList.remove('is-active');
      viewerMicBtn.classList.add('is-muted');
      viewerMicBtn.innerHTML = mutedSvg;
      viewerMicBtn.title = 'Mikrofon: Bisu (Klik untuk Bicara)';
    }
  }

  if (hostMicBtn) {
    const hostIcon = hostMicBtn.querySelector('svg');
    if (hostIcon) {
      hostIcon.outerHTML = isActive
        ? unmutedSvg.replace('width="18" height="18"', 'width="14" height="14"')
        : mutedSvg.replace('width="18" height="18"', 'width="14" height="14"');
    }
    if (hostMicLabel) hostMicLabel.textContent = isActive ? 'Mic: Aktif' : 'Mic: Mati';
    if (isActive) {
      hostMicBtn.classList.add('active');
    } else {
      hostMicBtn.classList.remove('active');
    }
  }
}

async function toggleFacecam() {
  if (isFacecamActive) {
    stopFacecam();
  } else {
    await startFacecam();
  }
}

async function startFacecam() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast('Peramban ini tidak mendukung akses kamera webcam.', 'error');
    return;
  }

  let camStream;
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: currentCamFacingMode,
        width: { ideal: 480 },
        height: { ideal: 480 }
      }
    });
  } catch (vErr) {
    console.error('Camera access failed:', vErr);
    showToast('Gagal mengakses kamera: ' + (vErr.message || 'Izin ditolak'), 'error');
    return;
  }

  localCamStream = camStream;
  isFacecamActive = true;

  // Show self preview
  if (currentRole === 'viewer') {
    const selfVideo = document.getElementById('selfFacecamVideo');
    const selfBubble = document.getElementById('selfFacecamBubble');
    if (selfVideo) selfVideo.srcObject = localCamStream;
    if (selfBubble) selfBubble.style.display = 'flex';

    if (viewerPeerConnection) {
      localCamStream.getTracks().forEach((track) => {
        viewerPeerConnection.addTrack(track, localCamStream);
      });
      try {
        const offer = await viewerPeerConnection.createOffer();
        await viewerPeerConnection.setLocalDescription(offer);
        ws.send(JSON.stringify({
          type: 'signal',
          signal: { sdp: viewerPeerConnection.localDescription }
        }));
      } catch (negErr) {
        console.warn('Renegotiation error:', negErr);
      }
    }
  } else if (currentRole === 'host') {
    const hostSelfVideo = document.getElementById('hostSelfCamVideo');
    const hostSelfBubble = document.getElementById('hostSelfBubble');
    if (hostSelfVideo) hostSelfVideo.srcObject = localCamStream;
    if (hostSelfBubble) hostSelfBubble.style.display = 'flex';

    for (const [vId, pc] of peerConnections.entries()) {
      localCamStream.getTracks().forEach((track) => {
        pc.addTrack(track, localCamStream);
      });
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        ws.send(JSON.stringify({
          type: 'signal',
          targetViewerId: vId,
          signal: { sdp: pc.localDescription }
        }));
      } catch (negErr) {
        console.warn('Host camera renegotiation error:', negErr);
      }
    }
  }

  updateCameraButtonsUI(true);

  // Notify peer(s)
  const camVideoTrack = localCamStream.getVideoTracks()[0];
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'facecam-status',
      enabled: true,
      camTrackId: camVideoTrack ? camVideoTrack.id : null
    }));
  }

  showToast('Kamera aktif.');
}

function stopFacecam() {
  if (localCamStream) {
    localCamStream.getTracks().forEach((t) => t.stop());
    localCamStream = null;
  }
  isFacecamActive = false;

  // Hide self preview
  const selfBubble = document.getElementById('selfFacecamBubble');
  if (selfBubble) selfBubble.style.display = 'none';
  const selfVideo = document.getElementById('selfFacecamVideo');
  if (selfVideo) selfVideo.srcObject = null;

  const hostSelfBubble = document.getElementById('hostSelfBubble');
  if (hostSelfBubble) hostSelfBubble.style.display = 'none';
  const hostSelfVideo = document.getElementById('hostSelfCamVideo');
  if (hostSelfVideo) hostSelfVideo.srcObject = null;

  updateCameraButtonsUI(false);

  // Notify peer(s)
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'facecam-status',
      enabled: false
    }));
  }

  showToast('Kamera dimatikan.');
}

function updateCameraButtonsUI(isActive) {
  const viewerCamBtn = document.getElementById('btnCameraToggle');
  const hostCamBtn = document.getElementById('btnHostCameraToggle');
  const hostCamLabel = document.getElementById('hostCameraBtnLabel');

  const onSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 7l-7 5 7 5V7z"></path><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>`;
  const offSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;

  if (viewerCamBtn) {
    if (isActive) {
      viewerCamBtn.classList.add('is-active');
      viewerCamBtn.innerHTML = onSvg;
      viewerCamBtn.title = 'Kamera: Aktif (Klik untuk Matikan)';
    } else {
      viewerCamBtn.classList.remove('is-active');
      viewerCamBtn.innerHTML = offSvg;
      viewerCamBtn.title = 'Kamera: Mati (Klik untuk Nyalakan)';
    }
  }

  if (hostCamBtn) {
    const hostIcon = hostCamBtn.querySelector('svg');
    if (hostIcon) {
      hostIcon.outerHTML = isActive
        ? onSvg.replace('width="18" height="18"', 'width="14" height="14"')
        : offSvg.replace('width="18" height="18"', 'width="14" height="14"');
    }
    if (hostCamLabel) hostCamLabel.textContent = isActive ? 'Kamera: Aktif' : 'Kamera: Mati';
    if (isActive) {
      hostCamBtn.classList.add('active');
    } else {
      hostCamBtn.classList.remove('active');
    }
  }
}

async function flipFacecamCamera() {
  if (!localCamStream) return;
  currentCamFacingMode = (currentCamFacingMode === 'user') ? 'environment' : 'user';

  const oldVideoTrack = localCamStream.getVideoTracks()[0];
  if (oldVideoTrack) oldVideoTrack.stop();

  try {
    const newStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: currentCamFacingMode,
        width: { ideal: 480 },
        height: { ideal: 480 }
      }
    });
    const newVideoTrack = newStream.getVideoTracks()[0];

    // Replace track in senders
    if (currentRole === 'viewer' && viewerPeerConnection) {
      const sender = viewerPeerConnection.getSenders().find(s => s.track && s.track.kind === 'video' && s.track !== localStream?.getVideoTracks()[0]);
      if (sender) sender.replaceTrack(newVideoTrack);
    } else if (currentRole === 'host') {
      peerConnections.forEach((pc) => {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video' && s.track !== localStream?.getVideoTracks()[0]);
        if (sender) sender.replaceTrack(newVideoTrack);
      });
    }

    localCamStream.removeTrack(oldVideoTrack);
    localCamStream.addTrack(newVideoTrack);

    const selfVideo = document.getElementById('selfFacecamVideo');
    if (selfVideo) {
      selfVideo.srcObject = localCamStream;
      selfVideo.style.transform = currentCamFacingMode === 'user' ? 'scaleX(-1)' : 'none';
    }

    showToast(currentCamFacingMode === 'user' ? 'Kamera depan aktif' : 'Kamera belakang aktif');
  } catch (err) {
    console.error('Flip camera failed:', err);
    showToast('Gagal memutar kamera: ' + err.message, 'error');
  }
}

function togglePartnerBubbleVisibility() {
  const bubble = document.getElementById('partnerFacecamBubble');
  if (bubble) {
    bubble.style.display = bubble.style.display === 'none' ? 'flex' : 'none';
  }
}

function handleFacecamStatus(data) {
  if (data.enabled) {
    partnerCamTrackId = data.camTrackId;
    if (currentRole === 'viewer') {
      const bubble = document.getElementById('partnerFacecamBubble');
      const label = document.getElementById('partnerFacecamLabel');
      if (label) label.textContent = data.from === 'host' ? 'Host' : 'Viewer';
      if (bubble) bubble.style.display = 'flex';
      showToast(data.from === 'host' ? 'Host menyalakan kamera.' : 'Viewer menyalakan kamera.');
    } else if (currentRole === 'host') {
      const bubble = document.getElementById('hostPartnerBubble');
      if (bubble) bubble.style.display = 'flex';
      showToast('Viewer menyalakan kamera.');
    }
  } else {
    partnerCamTrackId = null;
    if (currentRole === 'viewer') {
      const bubble = document.getElementById('partnerFacecamBubble');
      const video = document.getElementById('partnerFacecamVideo');
      if (bubble) bubble.style.display = 'none';
      if (video) video.srcObject = null;
      showToast(data.from === 'host' ? 'Host mematikan kamera.' : 'Viewer mematikan kamera.');
    } else if (currentRole === 'host') {
      const bubble = document.getElementById('hostPartnerBubble');
      const video = document.getElementById('hostPartnerCamVideo');
      if (bubble) bubble.style.display = 'none';
      if (video) video.srcObject = null;
      showToast('Viewer mematikan kamera.');
    }
  }
}

function makeDraggable(el) {
  if (!el) return;
  const handle = el.querySelector('[data-drag-handle]') || el;

  let isDragging = false;
  let startX = 0, startY = 0;
  let initialLeft = 0, initialTop = 0;

  function onPointerDown(e) {
    if (e.target.closest('button')) return;

    e.preventDefault();
    e.stopPropagation();

    isDragging = true;
    startX = e.clientX ?? (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
    startY = e.clientY ?? (e.touches && e.touches[0] ? e.touches[0].clientY : 0);

    const rect = el.getBoundingClientRect();
    const parent = el.parentElement;
    if (!parent) return;
    const parentRect = parent.getBoundingClientRect();

    initialLeft = rect.left - parentRect.left;
    initialTop = rect.top - parentRect.top;

    el.style.bottom = 'auto';
    el.style.right = 'auto';
    el.style.left = `${initialLeft}px`;
    el.style.top = `${initialTop}px`;

    document.addEventListener('pointermove', onPointerMove, { passive: false });
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('touchmove', onPointerMove, { passive: false });
    document.addEventListener('touchend', onPointerUp);
  }

  function onPointerMove(e) {
    if (!isDragging) return;
    e.preventDefault();
    e.stopPropagation();

    const clientX = e.clientX ?? (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
    const clientY = e.clientY ?? (e.touches && e.touches[0] ? e.touches[0].clientY : 0);

    const deltaX = clientX - startX;
    const deltaY = clientY - startY;

    const parent = el.parentElement;
    if (!parent) return;
    const parentRect = parent.getBoundingClientRect();
    const elWidth = el.offsetWidth;
    const elHeight = el.offsetHeight;

    let newLeft = initialLeft + deltaX;
    let newTop = initialTop + deltaY;

    const maxLeft = Math.max(0, parentRect.width - elWidth - 4);
    const maxTop = Math.max(0, parentRect.height - elHeight - 4);

    if (newLeft < 4) newLeft = 4;
    if (newLeft > maxLeft) newLeft = maxLeft;
    if (newTop < 4) newTop = 4;
    if (newTop > maxTop) newTop = maxTop;

    el.style.left = `${newLeft}px`;
    el.style.top = `${newTop}px`;
  }

  function onPointerUp() {
    if (!isDragging) return;
    isDragging = false;
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('touchmove', onPointerMove);
    document.removeEventListener('touchend', onPointerUp);
  }

  handle.addEventListener('pointerdown', onPointerDown);
  handle.addEventListener('touchstart', onPointerDown, { passive: false });
}

/* ========================================================
 * 7. Web Audio Voice Activity Detector (Active Speaker)
 * ======================================================== */
const voiceDetectors = new Map();

function startVoiceActivityDetection(stream, bubbleId) {
  stopVoiceActivityDetection(bubbleId);
  if (!stream || !stream.getAudioTracks || stream.getAudioTracks().length === 0) return;

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const audioCtx = new AudioContextClass();
    const sourceNode = audioCtx.createMediaStreamSource(stream);
    const analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 256;
    analyserNode.smoothingTimeConstant = 0.4;
    sourceNode.connect(analyserNode);

    const bufferLength = analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    let releaseTimeout = null;

    const intervalId = setInterval(() => {
      analyserNode.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const avg = sum / bufferLength;
      const bubbleEl = document.getElementById(bubbleId);

      // Volume threshold for active speaker
      if (avg > 14) {
        if (releaseTimeout) {
          clearTimeout(releaseTimeout);
          releaseTimeout = null;
        }
        if (bubbleEl && !bubbleEl.classList.contains('is-speaking')) {
          bubbleEl.classList.add('is-speaking');
        }
      } else {
        if (bubbleEl && bubbleEl.classList.contains('is-speaking') && !releaseTimeout) {
          releaseTimeout = setTimeout(() => {
            if (bubbleEl) bubbleEl.classList.remove('is-speaking');
            releaseTimeout = null;
          }, 350);
        }
      }
    }, 100);

    voiceDetectors.set(bubbleId, {
      audioCtx,
      sourceNode,
      analyserNode,
      intervalId,
      clearHang: () => { if (releaseTimeout) clearTimeout(releaseTimeout); }
    });
  } catch (err) {
    console.warn('Voice activity detection could not start:', err);
  }
}

function stopVoiceActivityDetection(bubbleId) {
  const detector = voiceDetectors.get(bubbleId);
  if (detector) {
    clearInterval(detector.intervalId);
    if (detector.clearHang) detector.clearHang();
    try {
      detector.sourceNode.disconnect();
      detector.audioCtx.close();
    } catch (e) {}
    voiceDetectors.delete(bubbleId);
  }
  const bubbleEl = document.getElementById(bubbleId);
  if (bubbleEl) bubbleEl.classList.remove('is-speaking');
}

function stopAllVoiceActivityDetection() {
  for (const bubbleId of voiceDetectors.keys()) {
    stopVoiceActivityDetection(bubbleId);
  }
}

/* ========================================================
 * 8. Keyboard Shortcuts (21st.dev Utility Pattern)
 *    F: Fullscreen | M: Suara Film | D: Mic | C/V: Kamera
 * ======================================================== */
function initKeyboardShortcuts() {
  window.addEventListener('keydown', (e) => {
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
      return;
    }
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    const key = e.key.toLowerCase();
    if (key === 'f') {
      e.preventDefault();
      toggleFullscreen();
    } else if (key === 'm') {
      e.preventDefault();
      toggleViewerAudio();
    } else if (key === 'd') {
      e.preventDefault();
      toggleSelfMic();
    } else if (key === 'c' || key === 'v') {
      e.preventDefault();
      toggleFacecam();
    }
  });
}
