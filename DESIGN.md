# ScreenCast x Rollbooth Design System

## Identity & Character
- **Product:** ScreenCast x Rollbooth (Peer-to-peer 60fps watch-party cinema paired with a dual-column 35mm photobooth darkroom).
- **Visual Language:** Analog 35mm Darkroom & Projection Print House. Inspired by physical celluloid film strips, silver-halide contact sheets, and classic repertory cinema schedules.
- **Identity Motif:** Perforated 35mm film sprocket rails and frame-counter timecodes (`FRM 01A .. 04A`) that frame live video captures and photobooth contact sheets.
- **Dials:** `Dial: ENERGY 2 / RHYTHM 3 / MOTION 2`

## Color Palette (Capped at 2 Core Neutrals + 1 Deliberate Accent per Theme)
### Projection Darkroom (Dark Theme - Default for Cinema Watching)
- **Canvas Primary (`--bg-canvas`):** `#111110` (Carbon celluloid base; minimizes screen glare while watching films in a dark room)
- **Surface / Contact Sheet (`--bg-surface`):** `#1A1917` (Elevated darkroom tray surface)
- **Ink Primary (`--ink-primary`):** `#F3EFE6` (Silver-gelatin warm paper white; 16.46:1 contrast on `#111110`)
- **Ink Secondary (`--ink-secondary`):** `#B8B2A6` (Muted warm silver; 8.33:1 contrast on `#1A1917`)
- **Interactive Border (`--border-strong`):** `#757066` (3.57:1 non-text contrast against `#1A1917`)
- **Primary Accent (`--accent-vermilion`):** `#B83B1A` button surface with `#FAF7F0` text (5.34:1 contrast) and `#F07148` darkroom safelight highlight (6.44:1 contrast on `#111110`).

### Daylight Contact Sheet (Light Theme - Working Toggle)
- **Canvas Primary (`--bg-canvas`):** `#F4F0E6` (Archival baryta photo paper)
- **Surface (`--bg-surface`):** `#EAE4D7` (Warm mounting board)
- **Ink Primary (`--ink-primary`):** `#181614` (Carbon printer ink; 15.86:1 contrast on `#F4F0E6`)
- **Ink Secondary (`--ink-secondary`):** `#4F4A42` (Graphite note ink; 6.93:1 contrast on `#EAE4D7`)
- **Interactive Border (`--border-strong`):** `#7D766A` (3.95:1 non-text contrast against `#F4F0E6`)
- **Primary Accent (`--accent-vermilion`):** `#B83B1A` with `#FAF7F0` text (5.34:1 contrast).

## Typography (Chosen for Brand Character)
- **Display / Headings (`Instrument Serif` / `Fraunces`):** High-contrast editorial serif evoking classic criterion film booklets and cinema marquees.
- **UI & Body (`Plus Jakarta Sans`):** Clean humanist sans-serif with wide apertures for legible controls at small sizes during video playback.
- **Technical Metadata (`IBM Plex Mono`):** Used strictly for functional 6-digit room codes, WebRTC telemetry (resolution, FPS, bitrate, ping), and film frame timestamps (`01:12:40`), never for large headings.

## One-Line Reasons for Major Visual Decisions (R-31)
- **Why this palette?** Warm carbon `#111110` and safelight vermilion `#B83B1A` reflect a physical photo darkroom and prevent eye strain during dark-room movie streaming, while `#F4F0E6` light mode mimics printed baryta photo paper.
- **Why this layout (RHYTHM 3)?** Sections vary intentionally by task: an asymmetric workbench hero with immediate room entry on the left and a film reel selector on the right, followed by an interactive darkroom contact-sheet table, a two-column technical ledger, and a single-column FAQ accordion.
- **Why this typography?** Serif headlines reference classic cinema programs, humanist sans handles dense media controls, and monospace is restricted to numeric timecodes and room digits.
- **Why this radius hierarchy?** Sharp `4px` corners on film frames mimic cut celluloid, `6px` on inputs/buttons signals interactive controls, and `10px` on the studio console frames the container.
- **Why the movie scene SVG illustrations?** Each SVG directly depicts a real scene from *La La Land*, *Interstellar*, *Spirited Away*, and *Blade Runner 2049* to demonstrate how the right column of the Rollbooth strip captures live film frames alongside webcam poses.
