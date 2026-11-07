# ScreenCast × Rollbooth · Design System & Architecture (`DESIGN.md`)

## 1. Aesthetic Direction & Core Philosophy
- **Aesthetic**: **Liquid Frosted Glass & WebGL Mesh Drift Shader**
- **Inspiration**: Original `ScreenCast` dark frosted-glass utility (`commit 0e2ee8b`), elevated with a restrained, high-craft landing structure that preserves the signature full-viewport WebGL gradient shader (`#meshDriftCanvas`) and immediate 6-slot OTP entry console.
- **Design Intent**: Keep the interface simple, focused, and atmospheric. The landing page opens directly with an elegant typographic introduction above the `Tonton Layar` / `Bagikan Layar` segmented console, followed by an interactive **Rollbooth Studio** preview card and a concise 3-step workflow guide. When a user joins or broadcasts a room (`body.is-watching` or `body.is-broadcasting`), all landing sections (`.landing-only`) automatically hide so the stream workspace has 100% focus.

---

## 2. Color Palette & WCAG 2.1 Contrast Verification (`R-21`)
All text/surface pairings were verified using `contrast-check.py`:

| Token | Hex / Value | Surface | Contrast Ratio | WCAG 2.1 Level | Role |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--bg-canvas` | `#0D1117` | Base viewport | N/A | N/A | Deep obsidian base behind `#meshDriftCanvas` |
| `--bg-panel` | `#12161F` (`rgba(18, 22, 31, 0.76)`) | Frosted glass card | N/A | N/A | Primary liquid frosted-glass panel (`blur(24px)`) |
| `--text-primary` | `#F0F6FC` | `#0D1117` / `#12161F` | `17.39:1` / `16.63:1` | **AAA** | Headlines, active controls, OTP digits |
| `--text-secondary` | `#9CA7B4` | `#12161F` | `7.41:1` | **AAA** | Subtitles, body copy, form labels |
| `--text-tertiary` | `#8B949E` | `#12161F` | `5.88:1` | **AA** | Metadata, helper text, keyboard shortcut hints |
| `--brand-accent` | `#1F6FEB` | `#FFFFFF` text | `4.63:1` | **AA** | Primary interactive CTA button fill |
| `--border-active` | `#58A6FF` | `#0B0E14` text | `7.65:1` | **AAA** | Active pill buttons, focus rings (`:focus-visible`), OTP active slot |
| `--accent-Ice` | `#79C0FF` | `#12161F` | `9.31:1` | **AAA** | Subtle badge highlights and eyebrow labels |

---

## 3. Typography & Scannable Hierarchy (`R-11`, `R-12`)
- **Primary UI & Headlines (`--font-sans`)**: `'Plus Jakarta Sans'`, `-apple-system`, `BlinkMacSystemFont`, sans-serif.
- **Editorial Accent (`--font-serif`)**: `'Instrument Serif'`, Georgia, serif (used selectively in italic for the hero title accent *"studio photobooth"*).
- **Technical & OTP Codes (`--font-mono`)**: `'JetBrains Mono'`, `ui-monospace`, `SFMono-Regular`, monospace (`font-variant-numeric: tabular-nums` for the 6-slot room code, WebRTC telemetry, and Rollbooth timestamps).
- **Type Scale**:
  - Hero Headline (`.hero-title`): `clamp(2rem, 3.8vw, 2.85rem)`, `font-weight: 700`, `line-height: 1.14`, `letter-spacing: -0.025em`.
  - Section Title (`.section-title`): `clamp(1.35rem, 2.4vw, 1.75rem)`, `font-weight: 600`, `letter-spacing: -0.02em`.
  - Panel Title (`.panel-title`): `1.35rem`, `font-weight: 600`.
  - Body Copy (`.panel-desc`, `.hero-subtitle`): `0.94rem` to `1.02rem`, `line-height: 1.6`, `max-width: 58ch`.

---

## 4. Layout Architecture & Viewport Budget (`R-13`, `R-14`, `R-28`, `R-29`)
- **Background Layer**: Fixed `#meshDriftCanvas` WebGL shader (`public/js/mesh-drift.js`) rendering organic navy, royal-blue, cyan, and indigo waves with subtle film grain.
- **Sticky Glass Header (`.app-header`)**: Brand logo (`ScreenCast` + `Rollbooth` pill), anchor links (`Ruang Siaran`, `Studio Photobooth`, `Cara Kerja`), live WebSocket status indicator (`#serverStatusDot` + `#serverStatusText`), and quick action button (`Buka Photobooth`).
- **Fold 1 · Hero Intro & Immediate Console (`#consoleSection`)**:
  - Compact centered hero intro (`.hero-intro.landing-only`) with eyebrow badge, headline, and 1-sentence subtitle.
  - Role switcher (`.segment-nav`) toggling between **Tonton Layar** (`#viewerSection`) and **Bagikan Layar** (`#hostSection`).
  - Centered frosted-glass card (`#viewerJoinCard`, `max-width: 460px`) with 6-slot OTP input (`#inputRoomCode`), `Tempel Kode`, explicit 4-state status feedback (`#roomStatusBanner` for idle, loading, error, active), primary `Mulai Menonton` CTA, secondary `Coba Photobooth Tanpa Kode` button, and recent rooms chips (`#viewerRecentRooms`).
- **Fold 2 · Interactive Rollbooth Studio Showcase (`#studioSection.landing-only`)**:
  - 2-column frosted-glass panel (`.studio-showcase-panel`, `max-width: 920px`) where users can test **Tata Letak** (`Strip Vertikal`, `Grid 2x2`, `Polaroid`), **Warna Bingkai** (`White`, `Cream`, `Noir`, `Pink`, `Matcha`), and **Filter** (`Retro 90s`, `Normal`, `B&W Noir`, `Sunset`) with a live visual strip preview (`#sampleStripCard`), or launch the real webcam photobooth (`Ambil 3 Pose Sekarang`).
- **Fold 3 · Restrained 3-Step Workflow (`#featuresSection.landing-only`)**:
  - 3 balanced frosted-glass cards (`max-width: 920px`) explaining `01 / Masuk atau Bagikan Layar`, `02 / Kamera Melayang & Suara Jernih`, and `03 / Cetak Foto Strip HD`.
- **Responsive Breakpoints (`R-28`)**:
  - Desktop (`> 960px`): 2-column studio showcase, 3-column workflow grid.
  - Tablet (`641px - 960px`): Stacked single-column studio showcase, 2-column workflow grid, hidden header nav links on narrow tablets.
  - Mobile (`<= 640px`): Fluid full-width panels, responsive OTP slots (`42px × 50px`), 44×44px minimum touch targets (`R-23`).

---

## 5. One-Line Design Decisions (`R-31`)
1. **Kept `#meshDriftCanvas` and `.panel` frosted glass (`rgba(18, 22, 31, 0.76)`, `blur(24px)`)**: Preserves the exact atmospheric gradient + dark glass identity the user requested while elevating typography and layout hierarchy.
2. **Kept the 6-slot OTP console in Fold 1**: Returning users can paste or type a 6-character room code immediately without scrolling past marketing filler (`R-13`).
3. **Interactive Rollbooth preview on the landing page**: Demonstrates the built-in 3-pose photobooth and lets visitors test frame colors, layouts, and standalone camera capture even before joining a stream.
4. **Automatic `.landing-only` suppression on active stream**: Adding `body.is-watching` or `body.is-broadcasting` hides the hero intro, studio showcase, workflow cards, and footer so the video player or broadcast dashboard gets 100% of the viewport.
