# Make Effects Design System

Visual design language and component patterns for the Make Effects application.

---

## Design Philosophy

**Minimal production workspace aesthetic** with solid app surfaces, restrained
depth, and blue-purple brand accents, supporting light and dark themes.

**Key Characteristics:**
- Solid surfaces for work areas, dialogs, cards, and tray chrome
- Blue-purple brand gradient (hue 276-308)
- Rounded corners with consistent radius scale
- Subtle shadows and depth
- Smooth micro-animations on interactions

---

## Color System

All colors use **OKLCH** color space for perceptually uniform transitions. Automatic theme adaptation via CSS `light-dark()` function.

| Category | Examples |
|----------|----------|
| **Brand** | Primary actions, links, highlights |
| **Surface** | Page background, cards, elevated surfaces |
| **Text** | Primary, muted, on-brand variants |
| **Semantic** | Error (red), success (green), warning (yellow) |
| **Accent** | Primary actions, focus states, subtle status emphasis |

---

## Typography

**Font Stack:** System fonts (SF Pro, Segoe UI, Roboto)

| Scale | Usage |
|-------|-------|
| Display (32px) | Page titles |
| H2 (24px) | Modal titles |
| H3 (20px) | Section titles |
| Body (15-16px) | UI text |
| Small (13-14px) | Metadata, labels |
| Micro (12px) | Badges, timestamps |

---

## Spacing & Sizing

| Category | Tokens |
|----------|--------|
| **Layout** | Header height, panel padding, section gaps |
| **Thumbnails** | lg (150px), sm (75px), xs (48px) |
| **Border Radius** | 6px (small), 8px (buttons), 12px (cards) |

---

## Component Patterns

| Component | Key Properties |
|-----------|---------------|
| **Primary Button** | Gradient background, shadow, hover lift |
| **Ghost Button** | Transparent with subtle border |
| **Cards** | Surface background, border, hover elevation |
| **Panels** | Solid surface, clear border, restrained shadow |
| **Inputs** | Border focus ring, primary color highlight |
| **Modals** | Solid panel, transparent backdrop, centered content |
| **Badges** | Pill shape, semantic colors |

---

## Animations

| Type | Usage |
|------|-------|
| `0.15s ease` | Quick hover states |
| `0.2s ease` | Standard button/card transitions |
| `0.3s cubic-bezier` | Panel/overlay transitions |

**Effects:** Hover lift (`translateY`), scale on icons, fade/slide for modals

---

## Guidelines

**Do:**
- Use CSS variables for all colors, spacing, shadows
- Use `light-dark()` for automatic theme support
- Use CSS Modules for component styles
- Use solid app surfaces for new UI

**Don't:**
- Hardcode hex colors
- Mix arbitrary border radius values
- Skip transitions on interactive elements
- Put blur, dimming, or translucent washes over generated media

---

## References

All design tokens are defined in:
- `src/frontend/styles/theme.css` — CSS variables
- `src/frontend/styles/global.css` — Reset, base styles
- Component `*.module.css` files — Component-specific styles
