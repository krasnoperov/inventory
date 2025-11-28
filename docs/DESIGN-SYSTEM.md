# Inventory Design System

This document defines the visual design language, color palette, typography, and component patterns used throughout the Inventory application.

## Design Philosophy

The Inventory app uses a **modern glass morphism aesthetic** with a blue-purple brand gradient. The design system supports both light and dark themes via CSS `light-dark()` function with OKLCH color space for perceptually uniform colors.

**Key Characteristics:**
- Glass morphism effects on elevated surfaces (blur, transparency)
- Blue-purple brand gradient (hue 276-308)
- Rounded corners with consistent radius scale
- Subtle shadows and depth
- Smooth micro-animations on interactions

---

## Color System

### Color Space

All colors use **OKLCH** (Oklab Lightness, Chroma, Hue) for perceptually uniform transitions and better dark mode support. Colors automatically adapt via CSS `light-dark()` function.

### Core Palette

#### Brand Colors
| Token | Light Mode | Dark Mode | Usage |
|-------|------------|-----------|-------|
| `--color-primary` | `oklch(55% 0.18 276)` | `oklch(65% 0.16 276)` | Primary actions, links, highlights |
| `--color-primary-hover` | `oklch(50% 0.18 276)` | `oklch(70% 0.16 276)` | Hover state for primary |

The brand gradient spans hue 276 (blue-violet) to 308 (purple-pink).

#### Surface Colors
| Token | Light Mode | Dark Mode | Usage |
|-------|------------|-----------|-------|
| `--color-bg` | `oklch(97% 0.005 264)` | `oklch(15% 0.015 264)` | Page background |
| `--color-surface` | `oklch(100% 0 0)` | `oklch(20% 0.015 264)` | Card backgrounds |
| `--color-surface-elevated` | `oklch(100% 0 0)` | `oklch(25% 0.015 264)` | Higher elevation surfaces |

#### Text Colors
| Token | Light Mode | Dark Mode | Usage |
|-------|------------|-----------|-------|
| `--color-text` | `oklch(20% 0.015 264)` | `oklch(92% 0.005 264)` | Primary body text |
| `--color-text-muted` | `oklch(45% 0.01 264)` | `oklch(70% 0.005 264)` | Secondary text, placeholders |
| `--text-on-brand-strong` | `oklch(100% 0 0 / 0.95)` | `oklch(85% 0 0 / 0.90)` | Text on brand gradient |
| `--text-on-brand-muted` | `oklch(92.5% 0.008 264 / 0.85)` | `oklch(78% 0.008 264 / 0.85)` | Secondary text on brand |
| `--text-on-brand-subtle` | `oklch(100% 0 0 / 0.75)` | `oklch(72% 0 0 / 0.75)` | Subtle text on brand |

#### Semantic Colors
| Token | Light Mode | Dark Mode | Usage |
|-------|------------|-----------|-------|
| `--color-error` | `oklch(55% 0.2 25)` | `oklch(70% 0.18 25)` | Error states, destructive actions |
| `--color-success` | `oklch(55% 0.15 145)` | `oklch(70% 0.13 145)` | Success states, confirmations |
| `--color-border` | `oklch(85% 0.005 264)` | `oklch(30% 0.015 264)` | Default borders |

#### Glass Morphism Colors
| Token | Light Mode | Dark Mode | Usage |
|-------|------------|-----------|-------|
| `--surface-glass` | `oklch(100% 0 0 / 0.12)` | `oklch(100% 0 0 / 0.08)` | Subtle glass surface |
| `--surface-glass-strong` | `oklch(100% 0 0 / 0.18)` | `oklch(100% 0 0 / 0.12)` | Elevated glass surface |
| `--surface-glass-intense` | `oklch(100% 0 0 / 0.24)` | `oklch(100% 0 0 / 0.18)` | High elevation glass |
| `--border-glass` | `oklch(100% 0 0 / 0.2)` | `oklch(100% 0 0 / 0.15)` | Glass border |
| `--border-glass-strong` | `oklch(100% 0 0 / 0.35)` | `oklch(100% 0 0 / 0.25)` | Strong glass border |

#### Status Colors
| Token | Usage |
|-------|-------|
| `--status-info-bg/border/text` | Info messages (cyan/sky blue) |
| `--status-warning-bg/border/text` | Warning messages (yellow/amber) |

### Role Badge Colors

These use RGBA values for colored badges:

| Role | Background | Text | Border |
|------|------------|------|--------|
| Owner | `rgba(99, 102, 241, 0.15)` | `var(--color-primary)` | `rgba(99, 102, 241, 0.3)` |
| Admin/Editor | `rgba(168, 85, 247, 0.15)` | `#a855f7` | `rgba(168, 85, 247, 0.3)` |
| Member/Viewer | `rgba(34, 197, 94, 0.15)` | `#22c55e` | `rgba(34, 197, 94, 0.3)` |

---

## Typography

### Font Stack

```css
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
  'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
```

**Monospace (code):**
```css
font-family: 'Monaco', 'Source Code Pro', Menlo, 'Courier New', monospace;
```

### Type Scale

| Size Token | Value | Usage |
|------------|-------|-------|
| Display | `2rem` (32px) | Page titles, hero text |
| Heading 2 | `1.5rem` (24px) | Modal titles |
| Heading 3 | `1.25rem` (20px) | Section titles, card headers |
| Body Large | `1rem` (16px) | Primary body text |
| Body | `0.9375rem` (15px) | Standard UI text |
| Body Small | `0.875rem` (14px) | Secondary text, metadata |
| Caption | `0.8125rem` (13px) | Small labels, hints |
| Micro | `0.75rem` (12px) | Badges, timestamps |

### Font Weights

| Weight | Value | Usage |
|--------|-------|-------|
| Regular | 400 | Body text |
| Medium | 500 | Buttons, emphasis |
| Semibold | 600 | Labels, headings |
| Bold | 700 | Titles, strong emphasis |

### Text Rendering

```css
-webkit-font-smoothing: antialiased;
-moz-osx-font-smoothing: grayscale;
text-rendering: optimizeLegibility;
line-height: 1.2; /* Global default */
```

---

## Spacing System

### Layout Spacing (CSS Variables)

| Token | Value | Usage |
|-------|-------|-------|
| `--header-height` | `90px` | Sticky header height |
| `--layout-gap` | `20px` | Primary section gaps |
| `--panel-spacing` | `1.5rem` (24px) | Card/panel padding |
| `--panel-spacing-sm` | `1rem` (16px) | Compact panel padding |

### Spacing Scale

| Size | Value | Usage |
|------|-------|-------|
| xs | `0.25rem` (4px) | Tight gaps, field spacing |
| sm | `0.5rem` (8px) | Component internal spacing |
| md | `0.75rem` (12px) | Button padding, gaps |
| base | `1rem` (16px) | Standard padding |
| lg | `1.5rem` (24px) | Section padding |
| xl | `2rem` (32px) | Large section gaps |
| 2xl | `3rem` (48px) | Page sections |
| 3xl | `4rem` (64px) | Empty states |

---

## Sizing System

### Thumbnail Sizes

| Token | Value | Usage |
|-------|-------|-------|
| `--thumb-size-lg` | `150px` | Main asset cards, variants |
| `--thumb-size-md` | `100px` | Lineage current image |
| `--thumb-size-sm` | `75px` | Forge slots, lineage nodes |
| `--thumb-size-xs` | `48px` | Tiny previews, picker items |

### Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--thumb-radius` | `10px` | Standard corners |
| `--thumb-radius-sm` | `6px` | Small element corners |
| - | `8px` | Buttons, inputs |
| - | `12px` | Cards, modals |
| - | `16px` | Large containers |
| - | `20px` | Glass form containers |
| - | `9999px` | Pills, badges |

---

## Shadows

### Shadow Scale

| Token | Value | Usage |
|-------|-------|-------|
| `--shadow-header` | `0 12px 24px oklch(0% 0 0 / 0.1-0.3)` | Sticky header |
| `--shadow-elevated` | `0 24px 40px oklch(0% 0 0 / 0.16-0.4)` | Elevated cards |
| `--shadow-floating` | `0 30px 50px oklch(0% 0 0 / 0.12-0.35)` | Floating panels |
| `--shadow-player` | `0 -12px 24px oklch(0% 0 0 / 0.15-0.35)` | Bottom panels |

### Button Shadows

| Token | Usage |
|-------|-------|
| `--button-primary-shadow` | `0 4px 12px oklch(62.19% 0.1845 276.62 / 0.4)` |
| `--button-primary-shadow-hover` | `0 16px 32px oklch(0% 0 0 / 0.25)` |

---

## Component Patterns

### Buttons

#### Primary Button
```css
background: var(--button-primary-bg); /* Gradient */
color: var(--button-primary-text);
border: var(--button-primary-border);
box-shadow: var(--button-primary-shadow);
border-radius: 8px;
padding: 0.75rem 1.5rem;
font-weight: 600;
transition: all 0.2s ease;
```

**Hover:** `transform: translateY(-1px)`, increased shadow

#### Ghost Button
```css
background: var(--button-ghost-bg);
color: var(--button-ghost-text);
border: 1px solid var(--button-ghost-border);
```

#### Text/Outline Button
```css
background: transparent;
border: 1px solid var(--color-border);
color: var(--color-text);
```
**Hover:** Border and text change to `--color-primary`

### Cards

```css
background: var(--color-surface);
border: 1px solid var(--color-border);
border-radius: 12px;
padding: 1.5rem;
transition: all 0.2s ease;
```

**Hover:**
```css
border-color: var(--color-primary);
transform: translateY(-2px);
box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
```

### Glass Containers (Forms, Forge)

```css
background: var(--surface-glass);
border: 1px solid var(--border-glass);
border-radius: 20px;
backdrop-filter: blur(18px);
box-shadow: var(--shadow-elevated);
```

### Inputs

```css
width: 100%;
padding: 0.75rem 1rem;
border: 1px solid var(--color-border);
border-radius: 8px;
background: var(--color-bg);
color: var(--color-text);
font-size: 1rem;
transition: border-color 0.2s ease, box-shadow 0.2s ease;
```

**Focus:**
```css
outline: none;
border-color: var(--color-primary);
box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.25);
```

### Modals

```css
background: var(--color-surface);
border-radius: 12px;
padding: 1.5rem;
max-width: 480px;
box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
```

**Overlay:**
```css
background: rgba(0, 0, 0, 0.5);
backdrop-filter: blur(4px);
```

### Badges

```css
padding: 0.25rem 0.75rem;
border-radius: 6px; /* or 9999px for pill */
font-size: 0.75rem;
font-weight: 600;
text-transform: uppercase;
letter-spacing: 0.5px;
```

---

## Animations

### Transition Timing

| Duration | Easing | Usage |
|----------|--------|-------|
| `0.15s ease` | Quick | Hover states, icons |
| `0.2s ease` | Standard | Buttons, cards |
| `0.25s cubic-bezier(0.4, 0, 0.2, 1)` | Smooth | Panel transitions |
| `0.3s cubic-bezier(0.4, 0, 0.2, 1)` | Emphasis | Sidebar, overlays |

### Keyframe Animations

```css
/* Loading spinner */
@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Pulsing indicator */
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

/* Shimmer effect (loading bar) */
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

/* Fade in */
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* Slide up (modals, messages) */
@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(16px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
```

### Hover Effects

Standard hover transform:
```css
transform: translateY(-1px); /* buttons */
transform: translateY(-2px); /* cards */
transform: scale(1.05); /* icons */
```

---

## Responsive Breakpoints

| Breakpoint | Target | Changes |
|------------|--------|---------|
| `> 768px` | Desktop | Full layout |
| `<= 768px` | Tablet | 1-2 columns, stacked navigation |
| `<= 480px` | Mobile | Single column, full-width elements |

### Grid Patterns

```css
/* Auto-fill responsive grid */
grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));

/* Space cards grid */
grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
```

---

## File Structure

```
src/frontend/styles/
├── global.css         # Reset, base styles, font stack
├── theme.css          # All CSS variables (colors, spacing, shadows)
└── markdown.module.css # Markdown rendering styles

src/frontend/components/
├── *.module.css       # Component-specific styles (CSS Modules)

src/frontend/pages/
├── *.module.css       # Page-specific styles
```

---

## Usage Guidelines

### Do's

1. **Use CSS variables** for all colors, spacing, and shadows
2. **Use `light-dark()`** for automatic theme support
3. **Use CSS Modules** for component styles to avoid conflicts
4. **Follow the type scale** for consistent typography
5. **Use the thumbnail size tokens** for consistent image sizing
6. **Apply glass morphism** selectively on elevated, branded surfaces

### Don'ts

1. **Don't use hardcoded hex colors** - use CSS variables
2. **Don't mix different border radius values** arbitrarily
3. **Don't use inline styles** except for dynamic values
4. **Don't add new colors** without updating this document
5. **Don't skip transitions** on interactive elements

---

## Changelog

- **v1.0** - Initial design system documentation
