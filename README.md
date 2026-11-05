# 🚀 ScreenCast - Share Screen PC Tanpa Aplikasi (WebRTC)

Aplikasi Web modern berbasis **WebRTC P2P** dan **WebSocket Signaling** untuk membagikan layar PC Anda secara langsung tanpa perlu meng-install aplikasi seperti AnyDesk atau TeamViewer di perangkat penerima.

---

## 🌟 Fitur Utama
- **Zero-Install (Penerima):** Penerima di HP, tablet, TV, atau laptop lain cukup buka browser & link atau scan QR Code.
- **WebRTC P2P Ultra-Low Latency:** Latensi sangat rendah (< 100ms) menggunakan public Google STUN server.
- **Audio Sharing:** Opsi membagikan suara audio sistem / browser bersama video layar.
- **High FPS Support:** Opsi hingga 60 FPS untuk pergerakan mulus.
- **Real-time Chat & WebRTC Stats:** Monitor resolusi dan FPS secara langsung.
- **Siap Dikembangkan (Extensible):** Arsitektur WebSocket sudah memiliki handler untuk event remote control (mouse/keyboard input) dan multi-viewer.

---

## 🛠️ Cara Menjalankan di PC

1. Buka Terminal / PowerShell di folder ini:
   ```bash
   cd "C:\Users\azu\.gemini\antigravity\scratch\webrtc-screenshare"
   ```
2. Jalankan server:
   ```bash
   node server.js
   ```
3. Buka browser di PC Anda:
   - Kunjungi: `http://localhost:3000`
   - Klik tombol **"Mulai Share Screen Sekarang"**.
   - Pilih layar, aplikasi, atau tab yang ingin dibagikan.

---

## 🌐 Cara Akses Jarak Jauh (Lewat Internet)

Agar orang di luar rumah / beda jaringan internet bisa menonton layar Anda tanpa perlu instal aplikasi:

### Cara 1: Menggunakan Cloudflare Tunnel (Gratis & Paling Cepat)
Jalankan perintah ini di terminal baru:
```bash
npx cloudflared tunnel --url http://localhost:3000
```
Anda akan mendapatkan link HTTPS publik resmi (misal: `https://contoh-acak.trycloudflare.com`). Bagikan link tersebut!

### Cara 2: Menggunakan LocalTunnel
```bash
npx localtunnel --port 3000
```

---

## 🚀 Roadmap Pengembangan Lanjutan
1. **Remote Control (Kendali Jarak Jauh):**
   - Menangkap koordinat klik/sentuhan dari HP penerima melalui WebRTC DataChannel.
   - Mengeksekusi gerakan mouse/keyboard di PC host menggunakan library `robotjs` atau `nut-js`.
2. **Room Password / PIN:**
   - Proteksi privasi agar hanya yang memiliki PIN yang dapat bergabung.
3. **Screen Recording:**
   - Fitur rekam langsung dari browser ke format WebM / MP4.
