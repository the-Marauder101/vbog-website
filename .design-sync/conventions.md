# VBOG — how to build with this design system

VBOG is a **CSS design kit, not a React component library**. There is no `window.VBOG.*` to import — `_ds_bundle.js` is deliberately empty-bodied. You build with plain elements, the classes below, and the custom properties in `styles.css`. Do not import components from a package; do not invent a component API.

## Setup

Link `styles.css` and put `.vbog` on the page root. Without it, nothing gets the brand background, colour, or body font.

```html
<body class="vbog">…</body>
```

Add `.vbog-dark` (Ink background) or `.vbog-forest` for dark sections. `.vbog` sets `border-radius: 0` on every descendant — square corners are a brand non-negotiable, not a default to override.

## The styling idiom

Component classes for the brand's own patterns; `var(--vbog-*)` custom properties for everything you build yourself. Never write a raw hex — every brand colour has a token.

| Family | Names |
|---|---|
| Surfaces | `.vbog`, `.vbog-dark`, `.vbog-forest`, `.vbog-shell`, `.vbog-shell-focused`, `.vbog-section` |
| Type | `.vbog-display`, `.vbog-h1`, `.vbog-h2`, `.vbog-h3`, `.vbog-kicker`, `.vbog-label`, `.vbog-muted`, `.vbog-disclaimer` |
| Actions | `.vbog-cta`, `.vbog-cta-dark`, `.vbog-text-link` |
| Proof | `.vbog-receipt`, `.vbog-receipt-tear`, `.vbog-receipt-line`, `.vbog-money`, `.vbog-proof` |
| Devices | `.vbog-grid-bg`, `.vbog-rail`, `.vbog-stamp`, `.vbog-ledger-row`, `.vbog-annotation`, `.vbog-portrait` |
| Colour tokens | `--vbog-ink`, `--vbog-paper`, `--vbog-paper-bright`, `--vbog-orange`, `--vbog-orange-dark`, `--vbog-acid`, `--vbog-forest`, `--vbog-muted-light`, `--vbog-line` |
| Layout tokens | `--vbog-max`, `--vbog-max-focused`, `--vbog-gutter`, `--vbog-section`, `--vbog-shadow`, `--vbog-shadow-lg`, `--vbog-shadow-xl`, `--vbog-grid-size`, `--vbog-radius` |
| Type tokens | `--vbog-display`, `--vbog-body`, `--vbog-mono`, plus tracking/leading vars |

Rules that are easy to get wrong:

- **Orange means the wound; Acid means the action.** Never swap them. CTAs are Acid or Ink — no other fill colour exists.
- **Orange text on a light background must be `--vbog-orange-dark`**, never `--vbog-orange` (contrast).
- **Three type roles only**: Georgia display for headlines, Arial body for paragraphs, mono for labels/prices/buttons/annotations. Mono is usually uppercase and never used for paragraphs. Sentence case headlines, never all caps, at most one italic phrase.
- **Shadows are hard offsets with zero blur** (`--vbog-shadow*`). No soft shadows, no rounded cards, no gradients without meaning, no glass, no glow.
- Use **two or three** signature devices per page, not all of them.
- Colour ratio ≈ 60% Ink-or-Paper base, 25% contrasting paper content, 10% Orange, 5% Acid.
- Every claim needs a mechanism, evidence, or a nearby `.vbog-disclaimer`. Never hide the price, the timeframe, or the guarantee.

## Where the truth lives

Read `styles.css` and its imports (`tokens/colors.css`, `tokens/typography.css`, `tokens/layout.css`, `vbog-base.css`) for exact values — every class above is defined there with a comment naming its source rule. `guidelines/vbog-brand-kit.md` is the full brand specification, including voice, positioning, imagery, and the preflight checklist. `guidelines/vbog-logo.svg` is the only permitted logo: never recolour, invert, filter, or crop it; minimum width 96px, normal header width 112px.

## Idiomatic example

```html
<section class="vbog-section vbog-dark vbog-grid-bg">
  <div class="vbog-shell">
    <p class="vbog-kicker">02 / What the ₹4L buys</p>
    <h2 class="vbog-display vbog-h2">
      Your agency is refusing revenue <em>it already earned</em>.
    </h2>
    <p style="max-width: 62ch; margin-top: 20px; color: var(--vbog-muted-light);">
      It is revenue your agency cannot safely fulfil without you.
    </p>
    <div class="vbog-ledger-row" style="margin-top: var(--vbog-section-focused);">
      <span>Delivery control</span>
      <span>Operator owns the capacity model.</span>
      <span>+₹3.2L / mo</span>
    </div>
    <a class="vbog-cta" href="/book" style="margin-top: 32px;">Book the installation call</a>
  </div>
</section>
```

## Voice

Write like a commercially literate operator: specific nouns, prices, timeframes, actions. "VBOG installs X. Your operation changes Y. The money effect is Z." Never "unlock your potential", "transform your business", "seamless end-to-end solutions", or unsupported revenue promises.
