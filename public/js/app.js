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
  initOtpBoxes();
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
    const clean = roomParam.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const input = document.getElementById('inputRoomCode');
    const roomCodeInput = document.getElementById('roomCodeInput');
    if (input) input.value = clean;
    if (roomCodeInput) roomCodeInput.value = clean;
    updateOtpSlots();
    setTimeout(() => joinRoomWithState(), 400);
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
        setRoomStatusBanner('error', 'GALAT RUANG', data.message || 'Kode ruang tidak ditemukan atau sudah ditutup.');
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
  document.body.classList.add('is-watching');
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
  document.body.classList.remove('is-watching');
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
function initOtpBoxes() {
  const boxes = Array.from(document.querySelectorAll('#otpGrid .otp-box'));
  if (boxes.length === 0) return;

  boxes.forEach((box, idx) => {
    box.addEventListener('input', (e) => {
      const val = (e.target.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      e.target.value = val.slice(-1);
      syncOtpBoxesToHiddenInputs();
      if (e.target.value && idx < boxes.length - 1) {
        boxes[idx + 1].focus();
        boxes[idx + 1].select();
      }
    });

    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace') {
        if (!box.value && idx > 0) {
          e.preventDefault();
          boxes[idx - 1].value = '';
          boxes[idx - 1].focus();
          syncOtpBoxesToHiddenInputs();
        } else {
          setTimeout(syncOtpBoxesToHiddenInputs, 0);
        }
      } else if (e.key === 'ArrowLeft' && idx > 0) {
        e.preventDefault();
        boxes[idx - 1].focus();
      } else if (e.key === 'ArrowRight' && idx < boxes.length - 1) {
        e.preventDefault();
        boxes[idx + 1].focus();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        joinRoomWithState();
      }
    });

    box.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasted = (e.clipboardData || window.clipboardData).getData('text') || '';
      const clean = pasted.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      if (!clean) return;
      boxes.forEach((b, i) => {
        b.value = clean[i] || '';
      });
      syncOtpBoxesToHiddenInputs();
      const nextIdx = Math.min(clean.length, boxes.length - 1);
      boxes[nextIdx].focus();
      if (clean.length === 6) {
        setRoomStatusBanner('empty', 'SIAP', `Kode ${clean} siap dihubungkan ke proyektor ruang.`);
      }
    });
  });
}

function syncOtpBoxesToHiddenInputs() {
  const boxes = Array.from(document.querySelectorAll('#otpGrid .otp-box'));
  const combined = boxes.map(b => (b.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '')).join('').slice(0, 6);
  const input1 = document.getElementById('inputRoomCode');
  const input2 = document.getElementById('roomCodeInput');
  if (input1) input1.value = combined;
  if (input2) input2.value = combined;
}

function updateOtpSlots() {
  const input = document.getElementById('inputRoomCode') || document.getElementById('roomCodeInput');
  if (!input) return;
  const raw = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (input.value !== raw) {
    input.value = raw;
  }
  const roomCodeInput = document.getElementById('roomCodeInput');
  if (roomCodeInput) roomCodeInput.value = raw;

  const boxes = Array.from(document.querySelectorAll('#otpGrid .otp-box'));
  boxes.forEach((box, index) => {
    box.value = raw[index] || '';
  });
}

function focusOtpInput() {
  const firstEmpty = Array.from(document.querySelectorAll('#otpGrid .otp-box')).find(b => !b.value);
  const target = firstEmpty || document.getElementById('otpBox1') || document.getElementById('inputRoomCode');
  if (target) {
    target.focus();
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
    showToast('Tautan ruang berhasil disalin ke papan klip.');
  });
}

function copyRoomCode() {
  if (!activeRoomId) return;
  navigator.clipboard.writeText(activeRoomId).then(() => {
    showToast(`Kode ruang ${activeRoomId} disalin ke papan klip.`);
  });
}

function toggleHostChatDrawer() {
  const drawer = document.getElementById('hostChatDrawer');
  if (!drawer) return;
  drawer.style.display = drawer.style.display === 'none' ? 'flex' : 'none';
}

function applyPreset() {
  const presetEl = document.getElementById('presetSelect');
  const resEl = document.getElementById('optResolution');
  const fpsEl = document.getElementById('optFps');
  const modeEl = document.getElementById('optMode');
  if (!presetEl) return;

  const val = presetEl.value;
  if (val === 'cinema') {
    if (resEl) resEl.value = '1080p';
    if (fpsEl) fpsEl.value = '60';
    if (modeEl) modeEl.value = 'motion';
  } else if (val === 'motion') {
    if (resEl) resEl.value = '720p';
    if (fpsEl) fpsEl.value = '60';
    if (modeEl) modeEl.value = 'motion';
  } else if (val === 'detail') {
    if (resEl) resEl.value = '1080p';
    if (fpsEl) fpsEl.value = '30';
    if (modeEl) modeEl.value = 'detail';
  } else if (val === 'native') {
    if (resEl) resEl.value = 'native';
    if (fpsEl) fpsEl.value = '60';
    if (modeEl) modeEl.value = 'motion';
  }
}

function startHosting() {
  startHostSharing();
}

function switchTab(mode) {
  document.body.classList.remove('is-watching');
  const isHost = mode === 'host';
  const hostBtn = document.getElementById('tabHostBtn');
  const viewerBtn = document.getElementById('tabViewerBtn');
  
  if (hostBtn) {
    hostBtn.className = isHost ? 'inspo-tab active' : 'inspo-tab';
    hostBtn.setAttribute('aria-selected', isHost ? 'true' : 'false');
  }
  if (viewerBtn) {
    viewerBtn.className = !isHost ? 'inspo-tab active' : 'inspo-tab';
    viewerBtn.setAttribute('aria-selected', !isHost ? 'true' : 'false');
  }

  const hostCard = document.getElementById('hostSetupCard');
  const viewerCard = document.getElementById('viewerJoinCard');
  if (hostCard) hostCard.style.display = isHost ? 'block' : 'none';
  if (viewerCard) {
    viewerCard.style.display = !isHost ? 'block' : 'none';
    if (!isHost) focusOtpInput();
  }
}

// Theme toggle, mobile navigation, room status states, and darkroom preview controls
function toggleColorTheme() {
  const htmlEl = document.documentElement;
  const current = htmlEl.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  htmlEl.setAttribute('data-theme', next);
  const label = document.getElementById('themeToggleLabel');
  if (label) {
    label.textContent = next === 'dark' ? 'Kertas Terang' : 'Kamar Gelap';
  }
  showToast(next === 'dark' ? 'Mode Kamar Gelap diaktifkan.' : 'Mode Kertas Hangat diaktifkan.');
}

function toggleMobileMenu() {
  const drawer = document.getElementById('mobileNavDrawer');
  const btn = document.getElementById('mobileMenuBtn');
  if (!drawer || !btn) return;
  const isHidden = drawer.hasAttribute('hidden');
  if (isHidden) {
    drawer.removeAttribute('hidden');
    btn.setAttribute('aria-expanded', 'true');
    btn.textContent = 'Tutup';
  } else {
    drawer.setAttribute('hidden', '');
    btn.setAttribute('aria-expanded', 'false');
    btn.textContent = 'Menu';
  }
}

function closeMobileMenu() {
  const drawer = document.getElementById('mobileNavDrawer');
  const btn = document.getElementById('mobileMenuBtn');
  if (drawer) drawer.setAttribute('hidden', '');
  if (btn) {
    btn.setAttribute('aria-expanded', 'false');
    btn.textContent = 'Menu';
  }
}

function setRoomStatusBanner(state, tagText, messageText) {
  const banner = document.getElementById('roomStatusBanner');
  const tag = document.getElementById('roomStatusTag');
  const text = document.getElementById('roomStatusText');
  if (!banner || !tag || !text) return;
  banner.classList.remove('state-empty', 'state-loading', 'state-error');
  banner.classList.add(`state-${state}`);
  tag.textContent = tagText;
  text.textContent = messageText;
}

function joinRoomWithState() {
  syncOtpBoxesToHiddenInputs();
  const codeInput = document.getElementById('inputRoomCode') || document.getElementById('roomCodeInput');
  const code = codeInput ? codeInput.value.trim().toUpperCase() : '';
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    setRoomStatusBanner(
      'error',
      'GALAT KODE',
      'Kode ruang harus terdiri dari 6 karakter. Periksa kembali kode dari penyelenggara tayangan.'
    );
    focusOtpInput();
    return;
  }
  setRoomStatusBanner(
    'loading',
    'MENGHUBUNGKAN',
    `Menghubungi sinyal ruang ${code}. Menunggu respons jalur video dari penyelenggara...`
  );
  joinRoomByInput();
}

let activeMoviePresetKey = 'lalaland';

const MOVIE_PRESETS = {
  lalaland: {
    reelTag: 'ROL 01 / TUNGSTEN 500T',
    code: 'VISION3 500T / 60FPS',
    caption: 'Sesi Kamera 35mm',
    badges: [
      'FRAME 01 / 00:14:20',
      'FRAME 02 / 00:38:10',
      'FRAME 03 / 01:05:42',
      'FRAME 04 / 01:29:15'
    ],
    toast: 'Emulsi Tungsten 500T dimuat ke meja cetak.'
  },
  interstellar: {
    reelTag: 'ROL 02 / AMBER 800T',
    code: 'SAFELIGHT 800T / 60FPS',
    caption: 'Amber Safelight',
    badges: [
      'AMBER 01 / 00:18:15',
      'AMBER 02 / 00:42:30',
      'AMBER 03 / 01:12:15',
      'AMBER 04 / 01:46:50'
    ],
    toast: 'Emulsi Amber Safelight 800T dimuat ke meja cetak.'
  },
  spiritedaway: {
    reelTag: 'ROL 03 / DAYLIGHT 250D',
    code: 'ETERNA 250D / 60FPS',
    caption: 'Daylight Cyan 250D',
    badges: [
      'ETERNA 01 / 00:19:40',
      'ETERNA 02 / 00:54:20',
      'ETERNA 03 / 01:28:12',
      'ETERNA 04 / 01:52:00'
    ],
    toast: 'Emulsi Daylight 250D dimuat ke meja cetak.'
  },
  bladerunner: {
    reelTag: 'ROL 04 / ILFORD HP5',
    code: 'ILFORD HP5 / 60FPS',
    caption: 'Monokrom Perak HP5',
    badges: [
      'HP5 01 / 00:11:05',
      'HP5 02 / 00:34:22',
      'HP5 03 / 01:08:05',
      'HP5 04 / 01:41:40'
    ],
    toast: 'Emulsi Perak Ilford HP5 dimuat ke meja cetak.'
  }
};

function selectMoviePreset(movieKey, scrollToStudio = false) {
  activeMoviePresetKey = MOVIE_PRESETS[movieKey] ? movieKey : 'lalaland';
  const preset = MOVIE_PRESETS[activeMoviePresetKey];
  const strip = document.getElementById('sampleStripWrap');
  if (strip) {
    strip.classList.remove('preset-lalaland', 'preset-interstellar', 'preset-spiritedaway', 'preset-bladerunner');
    if (activeMoviePresetKey !== 'lalaland') {
      strip.classList.add(`preset-${activeMoviePresetKey}`);
    }
  }

  const reelBadge = document.getElementById('activeReelCode');
  if (reelBadge) reelBadge.textContent = preset.reelTag;

  const topCode = document.getElementById('sampleStripTopCode');
  if (topCode) topCode.textContent = preset.code;

  const cap = document.getElementById('sampleStripCaption');
  if (cap) cap.textContent = preset.caption;

  preset.badges.forEach((text, idx) => {
    const badgeEl = document.getElementById(`sampleFilmBadge${idx + 1}`);
    if (badgeEl) badgeEl.textContent = text;
  });

  ['lalaland', 'interstellar', 'spiritedaway', 'bladerunner'].forEach(k => {
    const btn = document.getElementById(`presetBtn-${k}`);
    if (btn) btn.classList.toggle('active', k === activeMoviePresetKey);
    const card = document.getElementById(`reelCard-${k}`);
    if (card) {
      card.classList.toggle('active', k === activeMoviePresetKey);
      card.setAttribute('aria-pressed', k === activeMoviePresetKey ? 'true' : 'false');
    }
  });

  rollboothConfig.caption = preset.caption;
  const rbCapInput = document.getElementById('rollboothCaptionInput');
  if (rbCapInput) {
    rbCapInput.value = preset.caption;
  }

  if (scrollToStudio) {
    scrollToSection('studioShowcase');
  }
  showToast(preset.toast);
}

function openHeroAction(mode) {
  switchTab(mode);
  scrollToSection('cooldockHub');
}

function scrollToSection(id, e) {
  if (e) e.preventDefault();
  const el = document.getElementById(id);
  if (el) {
    const yOffset = -68;
    const y = el.getBoundingClientRect().top + window.pageYOffset + yOffset;
    window.scrollTo({ top: y, behavior: 'smooth' });
    if (id === 'heroSection' || id === 'cooldockHub') {
      setTimeout(() => focusOtpInput(), 420);
    }
  }
}

function setSampleLayout(layout) {
  const strip = document.getElementById('sampleStripWrap');
  if (!strip) return;
  strip.classList.remove('layout-strip', 'layout-grid', 'layout-polaroid');
  strip.classList.add(`layout-${layout}`);

  ['sampleLayoutStrip', 'sampleLayoutGrid', 'sampleLayoutPolaroid'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.classList.remove('active');
  });
  if (layout === 'strip') document.getElementById('sampleLayoutStrip')?.classList.add('active');
  if (layout === 'grid') document.getElementById('sampleLayoutGrid')?.classList.add('active');
  if (layout === 'polaroid') document.getElementById('sampleLayoutPolaroid')?.classList.add('active');
}

function setSampleFrame(bgColor, textColor, btnEl) {
  const strip = document.getElementById('sampleStripWrap');
  if (!strip) return;
  strip.style.background = bgColor;
  strip.style.color = textColor;
  if (btnEl && btnEl.parentElement) {
    btnEl.parentElement.querySelectorAll('.pg-swatch').forEach(b => b.classList.remove('active'));
    btnEl.classList.add('active');
  }
}

function setSampleFilter(filter) {
  const strip = document.getElementById('sampleStripWrap');
  if (!strip) return;
  strip.classList.remove('filter-vintage', 'filter-bw', 'filter-cinema', 'filter-normal');
  strip.classList.add(`filter-${filter}`);

  ['sampleBtn-normal', 'sampleBtn-bw', 'sampleBtn-vintage', 'sampleBtn-cinema'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.classList.remove('active');
  });
  document.getElementById(`sampleBtn-${filter}`)?.classList.add('active');
}

function toggleSampleSticker(stampText) {
  const layer = document.getElementById('sampleStickerLayer');
  if (!layer) return;
  const existing = Array.from(layer.querySelectorAll('.sample-sticker-item')).find(el => el.dataset.emoji === stampText);
  if (existing) {
    existing.remove();
    return;
  }
  const span = document.createElement('span');
  span.className = 'sample-sticker-item';
  span.dataset.emoji = stampText;
  span.textContent = stampText;
  const positions = [
    { top: '12px', right: '14px', transform: 'rotate(6deg)' },
    { bottom: '54px', left: '12px', transform: 'rotate(-8deg)' },
    { top: '44%', right: '10px', transform: 'rotate(4deg)' },
    { bottom: '18px', right: '16px', transform: 'rotate(-5deg)' }
  ];
  const pos = positions[layer.children.length % positions.length];
  Object.assign(span.style, pos);
  layer.appendChild(span);
}

function toggleFaq(btnEl) {
  if (!btnEl) return;
  const itemEl = btnEl.closest('.faq-item') || btnEl;
  const isOpen = itemEl.classList.contains('open');
  document.querySelectorAll('.faq-item').forEach(el => {
    el.classList.remove('open');
    const q = el.querySelector('.faq-question');
    if (q) q.setAttribute('aria-expanded', 'false');
  });
  if (!isOpen) {
    itemEl.classList.add('open');
    btnEl.setAttribute('aria-expanded', 'true');
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closePhotoboothModal();
    closeMobileMenu();
  }
});

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
    } else if (key === 'p') {
      e.preventDefault();
      triggerPhotobooth();
    }
  });
}

/* ========================================================
 * 9. Rollbooth Memories Studio Engine (rollbooth.com Concept)
 * ======================================================== */
let rollboothConfig = {
  layout: 'strip',       // 'strip' | 'grid' | 'polaroid'
  frameColor: 'white',   // 'white' | 'cream' | 'noir' | 'pink' | 'matcha'
  filter: 'vintage',     // 'vintage' | 'normal' | 'bw' | 'sunset'
  caption: 'Sesi Kamera 35mm'
};

let rollboothSnaps = []; // Array of 3 snapshots: [{ movie, cam1, cam2 }, ...]
let isPhotoboothCountingDown = false;
let currentPhotoboothBlob = null;
let currentPhotoboothDataUrl = null;
let standaloneCamVideoEl = null;

async function openRollboothStudio() {
  if (!localCamStream && navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
      });
      localCamStream = stream;
      isFacecamActive = true;
      if (!standaloneCamVideoEl) {
        standaloneCamVideoEl = document.createElement('video');
        standaloneCamVideoEl.muted = true;
        standaloneCamVideoEl.playsInline = true;
        standaloneCamVideoEl.autoplay = true;
      }
      standaloneCamVideoEl.srcObject = stream;
      await standaloneCamVideoEl.play().catch(() => {});
    } catch (e) {
      // Proceed using synthesized darkroom portrait + selected movie preset
    }
  }
  triggerPhotobooth();
}

function renderPresetMovieCanvas(presetKey, poseIndex = 0) {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 360;
  const ctx = c.getContext('2d');

  if (presetKey === 'interstellar') {
    const g = ctx.createRadialGradient(320, 175, 24, 320, 175, 220);
    g.addColorStop(0, '#040407');
    g.addColorStop(0.32, '#050508');
    g.addColorStop(0.42, '#fff7d6');
    g.addColorStop(0.58, '#f59e2d');
    g.addColorStop(0.82, '#6e2b0e');
    g.addColorStop(1, '#070913');
    ctx.fillStyle = '#070913';
    ctx.fillRect(0, 0, 640, 360);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(320, 175, 190, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(320, 175);
    ctx.rotate(-0.2);
    ctx.strokeStyle = '#ffdf9e';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.ellipse(0, 0, 220, 28, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#040407';
    ctx.beginPath();
    ctx.arc(320, 175, 56, 0, Math.PI * 2);
    ctx.fill();
  } else if (presetKey === 'spiritedaway') {
    const g = ctx.createLinearGradient(0, 0, 0, 360);
    g.addColorStop(0, '#183642');
    g.addColorStop(0.58, '#397367');
    g.addColorStop(1, '#e89973');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 640, 360);
    ctx.fillStyle = '#17444c';
    ctx.fillRect(0, 236, 640, 124);
    ctx.fillStyle = '#c83e37';
    ctx.fillRect(64 + poseIndex * 24, 188, 320, 48);
    ctx.fillStyle = '#f4d58d';
    ctx.fillRect(64 + poseIndex * 24, 210, 320, 8);
  } else if (presetKey === 'bladerunner') {
    const g = ctx.createLinearGradient(0, 0, 640, 360);
    g.addColorStop(0, '#0d1322');
    g.addColorStop(0.5, '#2c1638');
    g.addColorStop(1, '#d95b26');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 640, 360);
    ctx.fillStyle = 'rgba(0, 240, 255, 0.2)';
    ctx.fillRect(90, 0, 140, 360);
    ctx.fillStyle = 'rgba(255, 42, 133, 0.24)';
    ctx.fillRect(360, 0, 140, 360);
  } else {
    // Default: Tungsten 500T
    const g = ctx.createLinearGradient(0, 0, 0, 360);
    g.addColorStop(0, '#190e30');
    g.addColorStop(0.5, '#4e2268');
    g.addColorStop(0.84, '#b84a72');
    g.addColorStop(1, '#f09c67');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 640, 360);
    ctx.fillStyle = '#110920';
    ctx.fillRect(0, 280, 640, 80);
    ctx.fillStyle = '#fff7d6';
    ctx.beginPath();
    ctx.arc(170, 92, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#110920';
    ctx.fillRect(166, 104, 8, 176);
    ctx.fillStyle = '#f5c431';
    ctx.beginPath();
    ctx.moveTo(360, 175);
    ctx.lineTo(392, 255);
    ctx.lineTo(328, 255);
    ctx.closePath();
    ctx.fill();
  }

  const preset = MOVIE_PRESETS[presetKey] || MOVIE_PRESETS.lalaland;
  ctx.fillStyle = 'rgba(10, 9, 14, 0.78)';
  ctx.fillRect(24, 304, 592, 38);
  ctx.fillStyle = '#ffe66d';
  ctx.font = '600 16px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(preset.badges[poseIndex % preset.badges.length] || preset.code, 320, 329);
  ctx.textAlign = 'left';
  return c;
}

function renderPortraitPlaceholderCanvas(poseIndex = 0) {
  const c = document.createElement('canvas');
  c.width = 480;
  c.height = 360;
  const ctx = c.getContext('2d');
  const bgColors = ['#2B2623', '#252B28', '#2D2522'];
  ctx.fillStyle = bgColors[poseIndex % bgColors.length];
  ctx.fillRect(0, 0, 480, 360);

  ctx.fillStyle = 'rgba(243, 239, 230, 0.85)';
  ctx.beginPath();
  ctx.arc(185, 145, 42, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(185, 330, 95, Math.PI, 0);
  ctx.fill();

  ctx.fillStyle = 'rgba(243, 239, 230, 0.68)';
  ctx.beginPath();
  ctx.arc(305, 156, 38, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(305, 330, 86, Math.PI, 0);
  ctx.fill();

  ctx.fillStyle = 'rgba(17, 17, 16, 0.78)';
  ctx.fillRect(18, 18, 134, 30);
  ctx.fillStyle = '#F3EFE6';
  ctx.font = '600 13px ui-monospace, monospace';
  ctx.fillText(`POSE 0${poseIndex + 1} / 35MM`, 30, 38);
  return c;
}

function triggerPhotobooth() {
  if (isPhotoboothCountingDown) return;
  isPhotoboothCountingDown = true;
  rollboothSnaps = [];

  const overlay = document.getElementById('photoboothCountdownOverlay');
  const stepBadge = document.getElementById('photoboothStepBadge');
  const hintText = document.getElementById('photoboothHintText');
  const modal = document.getElementById('photoboothModal');

  if (modal) modal.style.display = 'none';
  if (overlay) overlay.style.display = 'flex';

  // Step 1: Snapshot 1 (Bersiap)
  if (stepBadge) stepBadge.textContent = 'Pose 1 dari 3: Bersiap';
  if (hintText) hintText.textContent = 'Pose pertama bersama tangkapan layar';

  runCountdownStep(3, () => {
    rollboothSnaps[0] = grabCurrentSnap(0);

    // Step 2: Snapshot 2 (Ganti Pose)
    setTimeout(() => {
      if (stepBadge) stepBadge.textContent = 'Pose 2 dari 3: Ganti Gaya';
      if (hintText) hintText.textContent = 'Tunjukkan ekspresi terbaik kalian';

      runCountdownStep(2, () => {
        rollboothSnaps[1] = grabCurrentSnap(1);

        // Step 3: Snapshot 3 (Pose Terakhir)
        setTimeout(() => {
          if (stepBadge) stepBadge.textContent = 'Pose 3 dari 3: Tahan Senyum';
          if (hintText) hintText.textContent = 'Bidikan terakhir untuk lembar kontak 35mm';

          runCountdownStep(2, () => {
            rollboothSnaps[2] = grabCurrentSnap(2);

            // Finish all 3 snaps
            if (overlay) overlay.style.display = 'none';
            isPhotoboothCountingDown = false;

            // Open Rollbooth Studio Modal
            if (modal) modal.style.display = 'flex';
            renderRollboothCanvas();
            showToast('3 pose selesai dipotret. Sesuaikan kertas dan unduh cetakan Anda.');
          });
        }, 600);
      });
    }, 600);
  });
}

function runCountdownStep(startCount, onFinish) {
  const countText = document.getElementById('photoboothCountText');
  const flash = document.getElementById('photoboothShutterFlash');
  let current = startCount;
  if (countText) countText.textContent = current;

  const timer = setInterval(() => {
    current--;
    if (current > 0) {
      if (countText) countText.textContent = current;
    } else {
      clearInterval(timer);
      if (countText) countText.textContent = 'RANA';

      // Trigger Flash & Sound
      if (flash) {
        flash.classList.remove('flash-active');
        void flash.offsetWidth;
        flash.classList.add('flash-active');
        setTimeout(() => flash.classList.remove('flash-active'), 350);
      }
      playShutterSound();

      setTimeout(onFinish, 120);
    }
  }, 900);
}

function grabCurrentSnap(poseIndex = 0) {
  const movieVid = (currentRole === 'host')
    ? document.getElementById('hostPreviewVideo')
    : document.getElementById('viewerVideo');
  const cam1 = (currentRole === 'host')
    ? document.getElementById('hostSelfCamVideo')
    : (document.getElementById('selfFacecamVideo')?.videoWidth ? document.getElementById('selfFacecamVideo') : standaloneCamVideoEl);
  const cam2 = (currentRole === 'host')
    ? document.getElementById('hostPartnerCamVideo')
    : document.getElementById('partnerFacecamVideo');

  function copyVideo(video) {
    if (!video || video.videoWidth === 0 || video.readyState < 2) return null;
    const c = document.createElement('canvas');
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(video, 0, 0);
    return c;
  }

  const capturedMovie = copyVideo(movieVid) || renderPresetMovieCanvas(activeMoviePresetKey, poseIndex);
  const capturedCam1 = copyVideo(cam1) || renderPortraitPlaceholderCanvas(poseIndex);
  const capturedCam2 = copyVideo(cam2);

  return {
    movie: capturedMovie,
    cam1: capturedCam1,
    cam2: capturedCam2
  };
}

function playShutterSound() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(850, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + 0.07);
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.07);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.07);

    setTimeout(() => {
      try {
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'square';
        osc2.frequency.setValueAtTime(360, ctx.currentTime);
        osc2.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.06);
        gain2.gain.setValueAtTime(0.25, ctx.currentTime);
        gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.06);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start();
        osc2.stop(ctx.currentTime + 0.06);
      } catch (e) {}
    }, 70);
  } catch (e) {}
}

/* ========================================================
 * Rollbooth Studio Live Controls (Layout, Color, Filter, Caption)
 * ======================================================== */
function setRollboothLayout(layout) {
  rollboothConfig.layout = layout;
  ['layoutBtnStrip', 'layoutBtnGrid', 'layoutBtnPolaroid'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.classList.remove('active');
  });
  if (layout === 'strip') document.getElementById('layoutBtnStrip')?.classList.add('active');
  if (layout === 'grid') document.getElementById('layoutBtnGrid')?.classList.add('active');
  if (layout === 'polaroid') document.getElementById('layoutBtnPolaroid')?.classList.add('active');
  renderRollboothCanvas();
}

function setRollboothColor(color) {
  rollboothConfig.frameColor = color;
  document.querySelectorAll('.color-swatch-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.color === color);
  });
  renderRollboothCanvas();
}

function setRollboothFilter(filter) {
  rollboothConfig.filter = filter;
  ['filterBtnVintage', 'filterBtnNormal', 'filterBtnBw', 'filterBtnSunset'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.classList.remove('active');
  });
  if (filter === 'vintage') document.getElementById('filterBtnVintage')?.classList.add('active');
  if (filter === 'normal') document.getElementById('filterBtnNormal')?.classList.add('active');
  if (filter === 'bw') document.getElementById('filterBtnBw')?.classList.add('active');
  if (filter === 'sunset') document.getElementById('filterBtnSunset')?.classList.add('active');
  renderRollboothCanvas();
}

function setRollboothCaption(text) {
  rollboothConfig.caption = text || 'Movie Night Memories';
  renderRollboothCanvas();
}

/* ========================================================
 * Rollbooth Canvas Renderer (Retro Film Strip Aesthetic)
 * ======================================================== */
function renderRollboothCanvas() {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  const themes = {
    white:  { bg: '#fbfbfb', text: '#18181b', subtext: '#71717a', border: '#e4e4e7' },
    cream:  { bg: '#f5efe6', text: '#2c231e', subtext: '#7d6f65', border: '#ded4c5' },
    noir:   { bg: '#12151d', text: '#ffffff', subtext: '#8b949e', border: '#272e3d' },
    pink:   { bg: '#ffe5ec', text: '#421d2a', subtext: '#8a4f65', border: '#f8bbd0' },
    matcha: { bg: '#d8e2dc', text: '#203328', subtext: '#5c7064', border: '#b8c5bc' }
  };

  const theme = themes[rollboothConfig.frameColor] || themes.white;

  const filters = {
    normal:  'none',
    vintage: 'sepia(0.28) contrast(1.15) brightness(1.04) saturate(1.18)',
    bw:      'grayscale(1) contrast(1.25) brightness(0.96)',
    sunset:  'sepia(0.38) hue-rotate(-12deg) contrast(1.12) saturate(1.3)'
  };
  const activeFilter = filters[rollboothConfig.filter] || 'none';

  // Date and room stamp
  const now = new Date();
  const dateStr = now.toLocaleDateString('id-ID', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '. ');
  const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  const roomTag = activeRoomId ? `RUANG: ${activeRoomId}` : 'SCREENCAST';

  const snap1 = rollboothSnaps[0] || {};
  const snap2 = rollboothSnaps[1] || {};
  const snap3 = rollboothSnaps[2] || {};

  if (rollboothConfig.layout === 'strip') {
    // ----------------------------------------------------
    // LAYOUT 1: Iconic Vertical 3-Cut Photostrip (460x1380)
    // ----------------------------------------------------
    const W = 460;
    const H = 1380;
    canvas.width = W;
    canvas.height = H;

    // Background
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, W, H);

    // Outer subtle border
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(1, 1, W - 2, H - 2);

    const padX = 26;
    const padTop = 32;
    const photoW = W - padX * 2; // 408px
    const photoH = 306;          // 4:3 ratio
    const gap = 16;

    // Photo 1 (Top: Movie Scene from Snap 1)
    const y1 = padTop;
    drawFilteredPhoto(ctx, snap1.movie, padX, y1, photoW, photoH, activeFilter, 'ADEGAN FILM');

    // Photo 2 (Middle: Reactions from Snap 2)
    const y2 = y1 + photoH + gap;
    if (snap2.cam1 && snap2.cam2) {
      // Split side-by-side
      const halfW = (photoW - 10) / 2;
      drawFilteredPhoto(ctx, snap2.cam1, padX, y2, halfW, photoH, activeFilter, currentRole === 'host' ? 'Host' : 'Viewer');
      drawFilteredPhoto(ctx, snap2.cam2, padX + halfW + 10, y2, halfW, photoH, activeFilter, currentRole === 'host' ? 'Viewer' : 'Host');
    } else if (snap2.cam1 || snap2.cam2) {
      drawFilteredPhoto(ctx, snap2.cam1 || snap2.cam2, padX, y2, photoW, photoH, activeFilter, 'REAKSI');
    } else {
      drawFilteredPhoto(ctx, snap2.movie, padX, y2, photoW, photoH, activeFilter, 'ADEGAN II');
    }

    // Photo 3 (Bottom: Final Pose from Snap 3)
    const y3 = y2 + photoH + gap;
    if (snap3.cam1 && snap3.cam2) {
      const halfW = (photoW - 10) / 2;
      drawFilteredPhoto(ctx, snap3.cam1, padX, y3, halfW, photoH, activeFilter, currentRole === 'host' ? 'Host' : 'Viewer');
      drawFilteredPhoto(ctx, snap3.cam2, padX + halfW + 10, y3, halfW, photoH, activeFilter, currentRole === 'host' ? 'Viewer' : 'Host');
    } else if (snap3.cam1 || snap3.cam2) {
      drawFilteredPhoto(ctx, snap3.cam1 || snap3.cam2, padX, y3, photoW, photoH, activeFilter, 'SENYUM');
    } else {
      drawFilteredPhoto(ctx, snap3.movie, padX, y3, photoW, photoH, activeFilter, 'ADEGAN III');
    }

    // Strip Footer
    const footerY = y3 + photoH + 28;
    ctx.textAlign = 'center';

    // Custom Caption
    ctx.fillStyle = theme.text;
    ctx.font = '700 19px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillText(rollboothConfig.caption || 'Sesi Kamera 35mm', W / 2, footerY);

    // Date & Time
    ctx.fillStyle = theme.subtext;
    ctx.font = '500 13px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText(`${dateStr} · ${timeStr} WIB`, W / 2, footerY + 28);

    // Rollbooth Branding & Barcode
    drawAestheticBarcode(ctx, W / 2 - 100, footerY + 44, 200, 32, theme.text);

    ctx.font = '800 11px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = theme.text;
    ctx.fillText(`ROLLBOOTH × ${roomTag}`, W / 2, footerY + 98);
    ctx.textAlign = 'left';

  } else if (rollboothConfig.layout === 'grid') {
    // ----------------------------------------------------
    // LAYOUT 2: Korean 2×2 Grid / Life4Cuts (860x1080)
    // ----------------------------------------------------
    const W = 860;
    const H = 1080;
    canvas.width = W;
    canvas.height = H;

    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);

    const pad = 30;
    const gap = 16;
    const gridW = (W - pad * 2 - gap) / 2; // 392px
    const gridH = 392; // 1:1 square photo

    // Top Row
    const yTop = pad + 16;
    drawFilteredPhoto(ctx, snap1.movie, pad, yTop, gridW, gridH, activeFilter, 'LAYAR 01');
    drawFilteredPhoto(ctx, snap2.cam1 || snap1.movie, pad + gridW + gap, yTop, gridW, gridH, activeFilter, 'KAMERA 01');

    // Bottom Row
    const yBot = yTop + gridH + gap;
    drawFilteredPhoto(ctx, snap2.cam2 || snap2.cam1 || snap2.movie, pad, yBot, gridW, gridH, activeFilter, 'KAMERA 02');
    drawFilteredPhoto(ctx, snap3.movie || snap3.cam1, pad + gridW + gap, yBot, gridW, gridH, activeFilter, 'LAYAR 02');

    // Footer
    const footerY = yBot + gridH + 34;
    ctx.fillStyle = theme.text;
    ctx.font = '700 24px -apple-system, sans-serif';
    ctx.fillText(rollboothConfig.caption || 'Sesi Kamera 35mm', pad, footerY);

    ctx.textAlign = 'right';
    ctx.fillStyle = theme.subtext;
    ctx.font = '600 14px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText(`ROLLBOOTH · ${dateStr} · ${roomTag}`, W - pad, footerY);
    ctx.textAlign = 'left';

  } else {
    // ----------------------------------------------------
    // LAYOUT 3: Wide Polaroid Hero (920x1200)
    // ----------------------------------------------------
    const W = 920;
    const H = 1200;
    canvas.width = W;
    canvas.height = H;

    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);

    const pad = 36;
    const heroW = W - pad * 2;
    const heroH = Math.round(heroW * (9 / 16)); // ~477px

    // Hero Screen Frame
    drawFilteredPhoto(ctx, snap1.movie, pad, pad, heroW, heroH, activeFilter, 'TANGKAPAN LAYAR');

    // Side-by-side reactions
    const reactY = pad + heroH + 20;
    const halfW = (heroW - 20) / 2;
    const reactH = 440;

    drawFilteredPhoto(ctx, snap2.cam1, pad, reactY, halfW, reactH, activeFilter, currentRole === 'host' ? 'Host' : 'Viewer');
    drawFilteredPhoto(ctx, snap2.cam2 || snap3.cam1, pad + halfW + 20, reactY, halfW, reactH, activeFilter, currentRole === 'host' ? 'Viewer' : 'Host');

    // Footer Polaroid
    const footerY = reactY + reactH + 34;
    ctx.fillStyle = theme.text;
    ctx.font = '700 22px -apple-system, sans-serif';
    ctx.fillText(rollboothConfig.caption || 'Sesi Kamera 35mm', pad, footerY);

    ctx.textAlign = 'right';
    ctx.fillStyle = theme.subtext;
    ctx.font = '500 14px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText(`ROLLBOOTH × SCREENCAST · ${dateStr}`, W - pad, footerY);
    ctx.textAlign = 'left';
  }

  // Update Result Image & Blob
  currentPhotoboothDataUrl = canvas.toDataURL('image/png');
  canvas.toBlob((blob) => {
    currentPhotoboothBlob = blob;
  }, 'image/png');

  const resultImg = document.getElementById('photoboothResultImg');
  if (resultImg) resultImg.src = currentPhotoboothDataUrl;
}

function drawFilteredPhoto(ctx, sourceCanvas, x, y, w, h, filterStr, label) {
  ctx.save();

  // Dark inner slot background
  ctx.fillStyle = '#06080d';
  drawRoundedRect(ctx, x, y, w, h, 6);
  ctx.fill();

  if (sourceCanvas && sourceCanvas.width > 0) {
    ctx.beginPath();
    drawRoundedRect(ctx, x, y, w, h, 6);
    ctx.clip();

    ctx.filter = filterStr;
    drawCoverCanvas(ctx, sourceCanvas, x, y, w, h);
    ctx.filter = 'none';
  } else {
    // Empty camera placeholder
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    drawRoundedRect(ctx, x, y, w, h, 6);
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#8b949e';
    ctx.font = '600 13px ui-monospace, monospace';
    ctx.fillText('35MM FRAME', x + w / 2, y + h / 2 - 6);
    ctx.font = '500 13px -apple-system, sans-serif';
    ctx.fillText(label || 'Foto', x + w / 2, y + h / 2 + 18);
    ctx.textAlign = 'left';
  }

  ctx.restore();

  // Thin photo outline
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  drawRoundedRect(ctx, x, y, w, h, 6);
  ctx.stroke();
}

function drawCoverCanvas(ctx, img, x, y, w, h) {
  const iW = img.width;
  const iH = img.height;
  const hRatio = w / iW;
  const vRatio = h / iH;
  const ratio = Math.max(hRatio, vRatio);
  const shiftX = (w - iW * ratio) / 2;
  const shiftY = (h - iH * ratio) / 2;

  ctx.drawImage(img, 0, 0, iW, iH, x + shiftX, y + shiftY, iW * ratio, iH * ratio);
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
  }
}

function drawAestheticBarcode(ctx, x, y, w, h, barColor) {
  ctx.fillStyle = barColor;
  let curX = x;
  let toggle = true;
  while (curX < x + w) {
    const barW = Math.random() > 0.4 ? 3 : 1.5;
    if (toggle) {
      ctx.fillRect(curX, y, barW, h);
    }
    curX += barW + (Math.random() > 0.5 ? 2.5 : 1.5);
    toggle = !toggle;
  }
}

function closePhotoboothModal() {
  const modal = document.getElementById('photoboothModal');
  if (modal) modal.style.display = 'none';
}

function downloadPhotoboothPhoto() {
  if (!currentPhotoboothDataUrl) return;
  const a = document.createElement('a');
  const filename = `Rollbooth-${rollboothConfig.layout}-${activeRoomId || 'live'}-${Date.now()}.png`;
  a.href = currentPhotoboothDataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast('Cetakan Rollbooth berhasil diunduh.');
}

async function copyPhotoboothPhoto() {
  if (!currentPhotoboothBlob) {
    showToast('Gambar belum siap untuk disalin.');
    return;
  }
  try {
    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': currentPhotoboothBlob })
      ]);
      showToast('Cetakan strip berhasil disalin ke papan klip.');
    } else {
      downloadPhotoboothPhoto();
    }
  } catch (err) {
    console.warn('Clipboard write error:', err);
    downloadPhotoboothPhoto();
  }
}

async function sharePhotoboothPhoto() {
  if (!currentPhotoboothBlob) return;
  try {
    const file = new File([currentPhotoboothBlob], `Rollbooth-${activeRoomId || 'memories'}.png`, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        title: 'Rollbooth Movie Memories',
        text: 'Cetakan strip 35mm dari sesi menonton di ScreenCast.',
        files: [file]
      });
      showToast('Cetakan berhasil dibagikan.');
    } else if (navigator.share) {
      await navigator.share({
        title: 'Rollbooth Movie Memories',
        text: 'Cetakan strip 35mm dari sesi menonton di ScreenCast.',
        url: window.location.href
      });
    } else {
      copyPhotoboothPhoto();
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      copyPhotoboothPhoto();
    }
  }
}
