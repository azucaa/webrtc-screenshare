# DESIGN.md : ScreenCast × Rollbooth (Chill Music Club × Inspo-MCP Analog Club Edition)

## 1. Visual Direction & Domain Exemplars
- **Primary Reference**: **Chill Music Club** (`https://www.lapa.ninja/post/chillmusic-club/`) combined with **`inspo-mcp`** (`split-studio` macrostructure + `daydream1820-com` / `atomixnyc-com` warm analog paper exemplars).
- **Aesthetic Persona**: *"The intimate analog lounge & 35mm darkroom club"*, inspired by independent record sleeves, cassette J-cards, and tactile contact sheets. Warm oat/cardboard paper ground (`#F4EFE6`), deep ink-blot charcoal (`#181614`), burnt terracotta stamp (`#B03E1A`), and zero generic movie franchise references.
- **Anti-Slop Decisions (`R-31`)**:
  - **One-line Palette Decision**: Warm analog sleeve paper `#F4EFE6` (`--color-paper`), pressed cardboard surface `#EAE2D3` (`--color-surface`), ink-blot charcoal `#181614` (`--color-ink`, `15.76:1` AAA), warm muted slate `#544E46` (`--color-muted`, `7.18:1` AAA), and burnt terracotta stamp `#B03E1A` (`--color-accent`, `5.17:1` AA on paper, `#FAF6F0` text on `#B03E1A` = `5.49:1` AA), with a toggleable Darkroom mode (`#121110` canvas, `#EDE8DF` ink `15.46:1` AAA).
  - **One-line Typography Decision**: Editorial display serif `Instrument Serif` (tight tracking `-0.025em`, line-height `0.98`, italic terracotta highlights) paired with geometric grotesk `Plus Jakarta Sans` for UI copy and `IBM Plex Mono` for J-card catalog numbers, room codes, and technical metadata.
  - **One-line Layout Decision**: `inspo-mcp` **Split Studio (`split-studio`)** 50/50 first-viewport split hero (`HeroSplitScreen`) with an analog Club J-Card Room Console on the left and a 2x2 Tactile Emulsion Crate (`#reelCatalog`) on the right, followed by a 12-column 35mm Contact Sheet Workbench (`FeaturesWorkbench`), a 3-column Numbered Protocol Triplet (`FeaturesNumberedTriplet`), an Editorial FAQ Accordion (`FaqAccordion`), and a 3-column Magazine Colophon (`FooterColophon`).

---

## 2. Color Tokens (WCAG 2.1 AA/AAA Verified via `contrast-check.py`)

### Default Theme: Warm Analog Club Paper (`data-theme="light"`)
| Token | Hex | Role | Contrast Ratio |
| :--- | :--- | :--- | :--- |
| `--color-paper` | `#F4EFE6` | Warm oat / vinyl sleeve background | Base canvas |
| `--color-surface` | `#EAE2D3` | Pressed cardboard card & workbench surface | Surface |
| `--color-elevated` | `#FAF7F2` | Elevated J-card & input platen | Elevated |
| `--color-ink` | `#181614` | Primary ink-blot charcoal text | **15.76:1** on `#F4EFE6` (AAA) |
| `--color-muted` | `#544E46` | Secondary liner-notes copy | **7.18:1** on `#F4EFE6` / **6.39:1** on `#EAE2D3` (AAA) |
| `--color-rule` | `#D5CBB8` | Hairline J-card & grid divider (`1px solid`) | Structural rule |
| `--color-rule-strong` | `#7A7267` | Active control & input border | **4.22:1** UI component (AA) |
| `--color-accent` | `#B03E1A` | Burnt terracotta club stamp & primary CTA | **5.49:1** with `#FAF6F0` text (AA) |
| `--color-accent-text` | `#B03E1A` | Italic serif highlight & active mono tag | **5.17:1** on `#F4EFE6` (AA) |

### Secondary Theme: Nocturnal Listening & Darkroom (`data-theme="dark"`)
| Token | Hex | Role | Contrast Ratio |
| :--- | :--- | :--- | :--- |
| `--color-paper` | `#121110` | Deep nocturnal booth background | Base canvas |
| `--color-surface` | `#1B1917` | Dark sleeve surface | Surface |
| `--color-elevated` | `#24211E` | Elevated control platen | Elevated |
| `--color-ink` | `#EDE8DF` | Warm silver halide white | **15.46:1** on `#121110` (AAA) |
| `--color-muted` | `#A8A196` | Muted warm stone | **6.85:1** on `#1B1917` (AAA) |
| `--color-accent` | `#B03E1A` | Burnt terracotta CTA fill | **5.49:1** with `#FAF6F0` text (AA) |
| `--color-accent-text` | `#F28B66` | Warm amber coral highlight | **7.78:1** on `#121110` (AAA) |
