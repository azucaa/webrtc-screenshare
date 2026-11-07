# DESIGN.md : ScreenCast x Rollbooth (Inspo-MCP Split Studio & Editorial Film Archive)

## 1. Visual Direction & Domain Exemplars (via `inspo-mcp`)
- **Macrostructure Pick (`inspo-mcp recommend`):** `split-studio` (Split Studio with hairline-ruled editorial sections).
- **Primary Exemplars & Reference Archetypes:**
  1. **FURO Web Studio (`furoweb-eu` via `inspo-mcp`):** Deep warm-black expanse (`#0C0B0A`), high-contrast `Instrument Serif` display typography with italic coral-vermilion accent clauses (`#FC9B7D` / `#B42E04`), and quiet architectural stillness.
  2. **Inspo Reference Archetypes (`inspo-mcp get_reference_jsx`):**
     - `nav/inline` (`NavInline`): Hairline-ruled top bar, serif wordmark with accent period on the left, mono metadata links and compact utility cluster on the right.
     - `hero/split-screen` (`HeroSplitScreen`): Full-bleed 50/50 split grid divided by a `1px` structural rule; editorial typography and room console on the left half, atmospheric CSS/SVG 35mm film archive specimen on the right half.
     - `features/workbench` (`FeaturesWorkbench`): 12-column split (5 columns explanatory copy and controls on the left, 7 columns interactive 35mm contact sheet workbench on the right).
     - `features/numbered-triplet` (`FeaturesNumberedTriplet`): 3 equal columns prefaced by a `2px solid var(--color-fg)` top rule and mono ordinal (`TAHAP 01`, `TAHAP 02`, `TAHAP 03`).
     - `faq/accordion` (`FaqAccordion`): 12-column intro header followed by hairline-ruled FAQ rows with `Instrument Serif` questions and a rotating `+` mono affordance.
     - `footer/colophon` (`FooterColophon`): 3-column magazine end-credit (`Tipografi`, `Tumpukan Teknis`, `Kolofon & Pintasan`).
- **Aesthetic Dial:** `ENERGY 2 / RHYTHM 3 / MOTION 2` (Measured editorial pacing, sharp hairline rules, tactile 35mm contact sheet specimens).

## 2. Color Palette & Atmospheric Polarity (WCAG AA Verified via `contrast-check.py`)
- **Dual / Adaptive Palette (`data-theme="dark"` default + working `data-theme="light"` Inspo-Paper mode):**
  - **Dark Mode (`data-theme="dark"`):**
    - `--color-paper` (`--color-bg`): `#0C0B0A` (Carbon Darkroom Ground)
    - `--color-surface`: `#141311` (Projection Platen Surface)
    - `--color-elevated`: `#1C1A17` (Control Well Surface)
    - `--color-ink` (`--color-fg`): `#EDE8DF` (`16.12:1` on `#0C0B0A`, PASS AAA)
    - `--color-muted` (`--color-fg-muted`): `#A8A196` (`7.25:1` on `#141311`, PASS AAA)
    - `--color-rule`: `#6E685F` (`3.37:1` on `#141311`, PASS 3:1 UI component boundary)
    - `--color-accent`: `#B42E04` (`inspo-mcp` warm vermilion anchor; `#FAF6F0` button text = `5.85:1`, PASS AA)
    - `--color-accent-text`: `#FC9B7D` (`inspo-mcp` coral-vermilion highlight; `9.48:1` on `#0C0B0A`, PASS AAA)
  - **Light Mode (`data-theme="light"`, Inspo-Paper):**
    - `--color-paper` (`--color-bg`): `#F5F1E8` (Warm Archival Newsprint)
    - `--color-surface`: `#EBE5D8` (Contact Sheet Platen)
    - `--color-elevated`: `#FFFFFF` (Bright Paper Well)
    - `--color-ink` (`--color-fg`): `#141311` (`16.47:1` on `#F5F1E8`, PASS AAA)
    - `--color-muted` (`--color-fg-muted`): `#524D45` (`6.68:1` on `#EBE5D8`, PASS AA)
    - `--color-rule`: `#787166` (`4.28:1` on `#F5F1E8`, PASS 3:1 UI boundary)
    - `--color-accent`: `#B42E04` (`#FAF6F0` button text = `5.85:1`, PASS AA)
    - `--color-accent-text`: `#9E2702` (`6.79:1` on `#F5F1E8`, PASS AA)

## 3. Typography & Scannable Hierarchy
- **Display Serif (`--font-display`):** `'Instrument Serif', Georgia, serif` (recommended by `inspo-mcp` exemplar analysis) for hero headlines, section headers, triplet titles, and FAQ questions.
- **UI & Body Sans (`--font-sans`):** `'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif` for room controls, form inputs, and body descriptions.
- **Technical Marginalia (`--font-mono`):** `'IBM Plex Mono', monospace` for `.text-meta` labels (`0.72rem`, `letter-spacing: 0.1em`, `text-transform: uppercase`), 6-digit OTP inputs, timecodes, and colophon metadata.

## 4. Layout, Spatial Architecture & Focal Point Design
- **Spacing System (`inspo-mcp spacingGuidance`):**
  - Vertical section rhythm: `padding-block: clamp(64px, 8vw, 112px)` applied consistently across all below-the-fold sections.
  - Horizontal container padding: `padding-inline: clamp(20px, 4vw, 56px)` declared separately from vertical rhythm so shorthand padding never zeroes section spacing.
- **One-Line Visual Decisions (R-31):**
  - **Hero Split-Screen Grid:** Uses a full-bleed 50/50 split with a `1px solid var(--color-rule)` center seam so the left half houses the immediate WebRTC room console and the right half showcases the interactive 35mm movie reel archive above the fold.
  - **Zero Rounded Card Blobs:** Replaces generic rounded SaaS cards with crisp hairline-ruled architectural cells (`border-radius: 0` on structural sections, `4px` on interactive buttons and inputs) to honor the `inspo-mcp` editorial specification.
  - **Workbench 5/7 Split:** Dedicates 5 columns to numbered darkroom print parameters and 7 columns to the live 35mm contact sheet specimen so controls and output remain visible side-by-side without scrolling.
