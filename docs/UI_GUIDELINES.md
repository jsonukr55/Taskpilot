# TaskPilot — UI Guidelines (Single Source of Truth)

**Read this before building or changing any UI.** Every screen must use the
tokens, mixins, and global classes defined here. This keeps buttons, spacing,
dialogs, and responsiveness identical everywhere.

The system lives in:
- `src/styles/_variables.scss` — design tokens (spacing, color, radius, type…)
- `src/styles/_mixins.scss` — reusable mixins (`card`, `btn-base`, `input-base`…)
- `src/styles/main.scss` — global component classes (`.btn`, `.form-input`, `.picker`…)

> **Golden rule:** never hard-code a pixel, hex, or color. Use a token
> (`$space-4`, `$radius-lg`) or a theme variable (`var(--text-secondary)`).
> If you're writing a raw value, you're probably doing it wrong.

Every component SCSS must start with:
```scss
@use 'variables' as *;
@use 'mixins' as *;
```

---

## 1. Spacing scale (use ONLY these)

| Token | Value | Typical use |
|---|---|---|
| `$space-1` | 4px | icon–text gap, tight inline |
| `$space-2` | 8px | gaps inside a control, small gaps |
| `$space-3` | 12px | gaps between related items |
| `$space-4` | 16px | field spacing, card inner rows |
| `$space-5` | 20px | card padding, grid gaps |
| `$space-6` | 24px | page padding, section spacing |
| `$space-8` | 32px | large section separation |
| `$space-10`–`$space-20` | 40–80px | hero / empty-state padding |

**Rules:** never use arbitrary margins/paddings. Prefer `gap` on a flex/grid
parent over per-child margins. Page container padding is `$space-6`.

---

## 2. Typography

Font: `$font-sans` (Plus Jakarta Sans). Mono: `$font-mono`.

| Token | Size | Use |
|---|---|---|
| `$font-size-xs` | 12px | meta, badges, `.btn-sm` label |
| `$font-size-sm` | 14px | **body default**, inputs, buttons |
| `$font-size-base` | 16px | emphasized body |
| `$font-size-lg` | 18px | card titles (`h2`/`h3`) |
| `$font-size-xl` | 20px | section titles |
| `$font-size-2xl` | 24px | modal titles |
| `$font-size-3xl` | 30px | page titles |

Weights: `$font-weight-normal` 400 · `-medium` 500 · `-semibold` 600 · `-bold` 700.
Titles are `semibold`/`bold`; body is `normal`/`medium`.

---

## 3. Color — use semantic theme variables (never raw hex)

Colors are theme-aware (`var(--…)`) and switch automatically in dark mode.
**Do not** use `$slate-900` etc. directly in components — use the `--` vars.

**Backgrounds:** `--bg-primary` (page) · `--bg-secondary` (cards/inputs) ·
`--bg-tertiary` (subtle fill, hover) · `--bg-elevated` (raised) · `--bg-overlay` (modal scrim).

**Text:** `--text-primary` (main) · `--text-secondary` (labels, muted) ·
`--text-tertiary` (placeholder, meta) · `--text-inverse` (on accent) · `--text-brand` (links/active).

**Borders:** `--border-subtle` · `--border-default` (inputs) · `--border-strong` (hover) · `--border-brand`.

**Accent (brand):** `--accent-500` (base, set at runtime) + `--accent-300/400/600/700` derived.
Buttons/links/active states use accent. Never hard-code indigo.

**Surfaces (tinted):** `--surface-brand` · `--surface-success` · `--surface-warning` · `--surface-danger`.

**Status/priority** (from `_variables.scss`): success `$emerald-500`, warning `$amber-500`,
danger `$rose-500`, urgent `#ff4444`. Prefer the `--surface-*` tints for backgrounds.

---

## 4. Radius, shadow, transition, z-index

- **Radius:** `$radius-sm` 4px · `$radius-md` 8px (small buttons) · `$radius-lg` 12px
  (buttons, inputs) · `$radius-xl` 16px (**cards**) · `$radius-full` (pills, swatches, avatars).
- **Shadow:** use `var(--card-shadow)` / `var(--card-shadow-hover)` via the `card` mixin.
  Raw `$shadow-*` only for popovers/menus.
- **Transition:** `$transition-fast` 150ms (hovers) · `$transition-normal` 250ms
  (cards) · `$transition-spring` (playful). Always transition specific props, not `all`, in new code.
- **Z-index (use the scale, never magic numbers):** dropdown 100 · sticky 200 ·
  overlay 300 · modal 400 · popover 500 · tooltip 600 · toast 700.

---

## 5. Buttons

Base is the `btn-base` mixin: `padding $space-2 $space-4` (8×16), radius `$radius-lg`,
font-size `$font-size-sm`, `gap $space-2`, disabled = 50% opacity + not-allowed.

**Variants (global classes):**
| Class | Use |
|---|---|
| `.btn-primary` | primary action (accent bg, white text). One per view/section. |
| `.btn-secondary` | secondary (tertiary bg + border) |
| `.btn-ghost` | low-emphasis / cancel (transparent) |
| `.btn-danger` | destructive (rose) — always confirm first |
| `.btn-icon` | icon-only, 36×36, transparent |

**Sizes:**
| Class | Padding | Font | Radius |
|---|---|---|---|
| (default) | 8×16 | 14px | `$radius-lg` |
| `.btn-sm` | **8×16** (`$space-2 $space-4`) | 12px | `$radius-md` |
| `.btn-lg` | 12×24 | 16px | `$radius-xl` |
| `.btn-block` | full width | — | — |

**Rules:**
- Always give an icon **and** a label for primary actions: `<tp-icon name="plus" [size]="14" /> New client`.
- Icon size inside a button: **14** (sm) / **16** (default).
- Never restyle a button inline. If you need a new look, it belongs here first.
- `btn-sm` is for compact toolbars/cards; it still has comfortable padding — do
  not shrink it further.

---

## 6. Forms

Inputs use the `input-base` mixin (`padding $space-3 $space-4`, radius `$radius-lg`,
focus ring `0 0 0 3px rgba(accent,.15)`).

**Global classes:** `.form-input` · `.form-textarea` (resize: vertical) · `.form-label`.
Custom select: `<tp-select [options]="…" formControlName="…">`.

**Field layout pattern** (label above control, tokenized gap):
```html
<div class="form-group">            <!-- or a scoped __field wrapper -->
  <label class="form-label">Name <span class="optional">(optional)</span></label>
  <input class="form-input" type="text" placeholder="e.g. Acme Inc.">
</div>
```
- Vertical gap between label and control: `$space-2`. Between fields: `$space-3`–`$space-4`.
- Inputs are always full-width inside their container.
- Placeholders are examples (`e.g. …`), not instructions.

---

## 7. Cards

Use the `card` mixin (radius `$radius-xl`, `var(--card-bg)`, `var(--card-border)`,
`var(--card-shadow)`, hover lift). Inner padding: **`$space-5`** (or `$space-6` for
roomy). Section/grid gaps: `$space-5`.

```scss
.my-card { @include card(false); padding: $space-5; }   // false = no hover lift
```

Card header pattern: `@include flex-between` with title (`h2`, `$font-size-lg`,
semibold) left and a `.btn-sm` action right.

---

## 8. Modals / Dialogs

**Structure** (overlay scrim + centered panel):
```html
<div class="modal-overlay" (click)="close()">
  <div class="modal scale-in" (click)="$event.stopPropagation()">
    <div class="modal__header"> <h2>Title</h2> <button class="btn-icon">…×</button> </div>
    <div class="modal__body"> … </div>
    <div class="modal__footer"> …cancel / confirm… </div>
  </div>
</div>
```

**Standard sizes** (panel `width: 100%` + `max-width`):
| Size | max-width | Use |
|---|---|---|
| Small | `420px` | confirm, single field |
| **Standard** | `520–580px` | most create/edit forms (create-task = 580) |
| Large | `720px` | multi-column / rich content |

**Rules:**
- Overlay uses `var(--bg-overlay)`; z-index `$z-modal` (CDK overlays already set this).
- Title = `$font-size-2xl`? No — modal titles are `$font-size-xl`/`2xl`, semibold. Header
  has a close `.btn-icon`.
- Footer actions are right-aligned: ghost **Cancel** then primary **Confirm**.
- **Mobile (`< $bp-md`)**: modal goes near-full-width (`width: 100vw` or `max-width` with
  `$space-4` side margins). Never let a dialog overflow the viewport.
- Long bodies scroll **inside** `modal__body`, not the page.

**Inline forms** (like the admin "New client" card): follow the same field spacing;
wrap in a padded container (`$space-4`, `background var(--bg-tertiary)`, `$radius-lg`)
with right-aligned actions.

---

## 9. Drawers (side panels)

Right-side sheet (see task-drawer): `width: 40%`, `min-width: 400px`, `max-width: 680px`.
**Mobile (`< $bp-md`)**: `width: 100vw; min-width: 0`. z-index `$z-modal`.

---

## 10. Pickers (icon + color)

Reuse the **global** `.picker` component — do not reinvent:
```html
<div class="picker">
  @for (ic of ICONS; track ic) {
    <button type="button" class="picker__item" [class.active]="icon() === ic"
            (click)="icon.set(ic)">{{ ic }}</button>
  }
</div>
<div class="picker">
  @for (c of COLORS; track c) {
    <button type="button" class="picker__swatch" [class.active]="color() === c"
            [style.background]="c" (click)="color.set(c)"></button>
  }
</div>
```
- `picker__item` = 40×40 emoji tile; `picker__swatch` = 32×32 round.
- Active state uses `.active` (accent border) — **not** custom classes.

---

## 11. Lists & rows

Row pattern: flex, `gap $space-3`, `padding $space-2`, `radius $radius-md`,
hover `background var(--bg-tertiary)`. Leading avatar/icon 32×32 (`$radius-md`),
name flex-1 truncated (`text-truncate` mixin), trailing meta `$font-size-xs`
`--text-tertiary`. Chips/tags: `$radius-full`, `--bg-elevated`, `$font-size-xs`.

---

## 12. Icons

- **UI/chrome icons:** ng-icons via `<tp-icon name="check-square" [size]="16" />`.
  Names are kebab-case; they resolve through the registry in `src/app/shared/icons.ts`.
  **Only use names registered there** — add new ones to `APP_ICONS` first.
- **Entity avatars** (client/org/space/group/category): an **emoji** on a tinted
  round/rounded chip (`background: color + '22'`), not an ng-icon.
- Icon sizes: 12 (meta) · 14 (in `.btn-sm`, chips) · 16 (buttons, inputs) ·
  18 (nav, card titles) · 20–22 (page/modal titles).

---

## 13. Responsiveness

**Breakpoints** (`$bp-*`): sm 640 · md 768 · lg 1024 · xl 1280 · 2xl 1536.
**Mixins** (mobile-first `min-width`): `@include sm/md/lg/xl { … }`, plus
`@include mobile-only`, `@include tablet-only`.

**Rules:**
- Content max width: `$content-max-width` (1200px), centered with `margin: 0 auto`.
- Multi-column grids collapse to 1 column on small screens
  (e.g. admin grid: `grid-template-columns: 1fr 1fr` → `1fr` under ~900px / `$bp-md`).
- The **page body must never scroll horizontally.** Wide content (tables, code,
  diagrams) scrolls inside its own `overflow-x: auto` container.
- Sidebar: `$sidebar-width` 260px, collapses to `$sidebar-collapsed` 72px;
  becomes an overlay on mobile. Topbar height `$topbar-height` 64px.
- Touch targets ≥ 40px on mobile. Modals/drawers go full-width under `$bp-md`.
- Test every new screen at 375px, 768px, and 1440px.

---

## 14. Feedback: tooltips, toasts, badges, empty states

- **Tooltip:** `data-tooltip="…"` attribute (+ `TooltipDirective`). z `$z-tooltip`.
- **Toast:** `ToastService.success/error/info(…)`. Never `alert()`. z `$z-toast`.
- **Badge/pill:** small, `$radius-full`, `$font-size-xs`, tinted surface.
- **Empty state:** centered icon/emoji + one muted sentence + (optional) primary action.
- **Loading:** skeleton via `shimmer` mixin, or a `.btn-spinner`. Don't block the whole page.

---

## 15. "Coming soon" / disabled features

Consistent treatment (see AI features):
- Nav item: non-clickable, muted, with a small "Soon" pill + `data-tooltip="Coming soon"`.
- Button: `disabled` + `data-tooltip="Coming soon"`, label may append `· Soon`.
- Section: replace content with a centered muted line ("… is coming soon").
- Gate behind a flag in `environment.features` so it flips on cleanly.

---

## 16. Accessibility

- All interactive elements use `@include focus-ring` (inherited by `btn-base`/inputs).
- Icon-only buttons need `aria-label` or `data-tooltip`.
- Respect disabled state (opacity .5, `pointer-events: none`).
- Maintain text contrast via the theme vars (already tuned for light/dark).
- Use semantic elements (`button`, `a`, `label`, `h1–h3`) — not clickable `div`s
  (except the deliberate "coming soon" non-link).

---

## Quick checklist before you commit UI

- [ ] `@use 'variables'`/`'mixins'` at top; **no raw px/hex** — tokens only.
- [ ] Buttons use `.btn-*` classes + correct size; primary has icon + label.
- [ ] Inputs use `.form-input`/`.form-label`; fields spaced with `$space-3/4`.
- [ ] Cards use the `card` mixin + `$space-5` padding.
- [ ] Dialog uses `.modal` structure + a standard max-width; full-width on mobile.
- [ ] Pickers reuse global `.picker`.
- [ ] Colors are `var(--…)` (theme-aware, works in dark mode).
- [ ] Icons registered in `icons.ts`; sizes from the scale.
- [ ] Verified at 375 / 768 / 1440px; no horizontal page scroll.
- [ ] New shared pattern? Add it to `main.scss`/mixins **and to this file.**
