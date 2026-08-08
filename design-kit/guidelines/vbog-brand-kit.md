# VBOG Brand Kit

Use this document as a build specification, not inspiration. If a design choice is not defined here, keep it simple and use the closest existing VBOG component.

## 1. Brand idea

**VBOG installs operational ownership.**

VBOG should feel:

- commercially sharp, not corporate;
- premium, not polished-to-death;
- engineered, not “creative agency”;
- provocative, not loud;
- credible enough for a ₹4L decision.

The visual world is an **operating document crossed with a revenue receipt**: grids, ledgers, stamps, proof, hard rules and conspicuous numbers.

## 2. Positioning hierarchy

Always use these ideas in this order:

1. **Pain:** the agency is refusing or damaging revenue.
2. **Constraint:** delivery capacity and operating ownership still depend on the founder.
3. **Product:** Agency Capacity Installation.
4. **Outcome:** accept and fulfil more demand without increasing founder workload.
5. **Mechanism:** capacity model, decision rights, delivery control and an internal operator.
6. **Commercial:** ₹4L fixed, 90 days.
7. **Risk reversal:** if the agreed system is not installed and used live, VBOG keeps working in scope without additional professional fees.

Campaign language may change. The product does not.

- **Revenue Refusal** = pain-led campaign.
- **Scaling as a Service** = creative campaign angle.
- **Agency Capacity Installation** = product category.

## 3. Logo

Use only `assets/vbog-logo.svg`.

- Keep its white background and orange square.
- Never recolour, invert, filter, outline or recreate it in text.
- Do not crop the white canvas.
- Minimum digital width: **96 px**.
- Normal header width: **112 px**.
- Keep clear space equal to half the orange-square width on all sides.

## 4. Colour system

| Token | Hex | Use |
|---|---|---|
| Ink | `#111510` | Main dark background, text, rules |
| Paper | `#F4EFE3` | Main light background |
| Paper Bright | `#FFFDF6` | Receipts, cards, logo surroundings |
| VBOG Orange | `#F45B2F` | Pain, urgency, shadows, key emphasis |
| Orange Dark | `#C43D1B` | Orange text on light backgrounds |
| Acid | `#DFF47A` | Action, positive money effect, CTA |
| Forest | `#193429` | Secondary dark panel, qualification |
| Light Muted | `#A6A89F` | Supporting copy on dark backgrounds |

### Colour ratio

- **60%** Ink or Paper base.
- **25%** contrasting Paper/Paper Bright content.
- **10%** Orange.
- **5%** Acid.

Orange identifies the wound or tension. Acid identifies the action, proof of change or commercial upside. Do not swap those meanings.

### Copy-ready CSS tokens

```css
:root {
  --vbog-ink: #111510;
  --vbog-paper: #f4efe3;
  --vbog-paper-bright: #fffdf6;
  --vbog-orange: #f45b2f;
  --vbog-orange-dark: #c43d1b;
  --vbog-acid: #dff47a;
  --vbog-forest: #193429;
  --vbog-muted-light: #a6a89f;
  --vbog-display: Georgia, "Times New Roman", serif;
  --vbog-body: Arial, Helvetica, sans-serif;
  --vbog-mono: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
}
```

## 5. Typography

Only three type roles:

### Display

`Georgia, "Times New Roman", serif`

- Headlines, major claims and pull quotes.
- Weight: 700 for statements; 400–500 italic for one emotional phrase.
- Letter spacing: `-0.04em` to `-0.06em`.
- Line height: `0.90` to `1.02`.
- Sentence case. Never all caps.

### Body

`Arial, Helvetica, sans-serif`

- Explanations and paragraphs.
- Line height: `1.55` to `1.65`.
- Do not centre long body copy.

### Mono

`"SFMono-Regular", Consolas, "Liberation Mono", monospace`

- Labels, prices, steps, evidence, buttons and annotations.
- Usually uppercase.
- Letter spacing: `0.06em` to `0.16em`.
- Never use mono for long paragraphs.

## 6. Signature visual devices

Every major VBOG asset should use **two or three**, not all, of these:

1. **Operating grid:** 42 px square grid at 4–5% opacity.
2. **Three-colour rail:** Orange → Ink → Acid, normally 34% / 32% / 34%.
3. **Hard offset shadow:** 5–18 px, no blur; Orange, Acid or Ink.
4. **Receipt:** Paper Bright, torn top, dashed rules, large mono number.
5. **Stamp:** rotated `-3deg` to `-6deg`, double border, mono uppercase.
6. **Ledger row:** label → operating change → money effect.
7. **Annotation box:** thin one-pixel rule, mono label, no rounded corners.
8. **Large money number:** Orange mono, tight negative letter spacing.

## 7. Component recipes

### Primary CTA

- Acid background.
- Ink text and 1 px Ink border.
- Mono uppercase, 8–11 px.
- Hard 5 px Ink or Orange shadow.
- Square corners.
- Arrow at the far right: `↗`.

### Dark CTA

- Ink background.
- Paper Bright text.
- Use only in light headers or light sections.

### Receipt card

- Paper Bright background.
- 1 px Ink outline.
- Ink or Orange hard shadow.
- Mono labels.
- One dominant commercial number.
- One disclaimer in 6–8 px mono.

### Section heading

- Mono kicker first: `02 / WHAT THE ₹4L BUYS`.
- Large Georgia headline.
- One highlighted phrase maximum.
- Supporting copy under 90 words.

### Proof card

- One case label.
- One dominant result.
- One short explanation.
- One outcome disclaimer nearby.

## 8. Layout rules

- Long-form page maximum width: **1240 px**.
- Focused VSL or booking page maximum width: **800 px**.
- Desktop outer gutter: **40–64 px**.
- Mobile outer gutter: **18–24 px**.
- Major section spacing: **88–160 px**.
- Focused VSL section spacing: **50–76 px**.
- Borders: 1 px; black or 12–22% white.
- Corner radius: **0 px**.
- Use asymmetry inside a stable grid.
- Keep one dominant idea per viewport.

## 9. Image treatment

- Prefer real founder, operator and client evidence.
- Founder photographs: grayscale, slightly increased contrast, Orange offset block.
- No generic stock imagery.
- No floating 3D blobs, gradients without meaning, glass cards or neon glows.
- Compress photographs to WebP where possible.

## 10. Voice

Write like a commercially literate operator.

### Do

- “Your agency is refusing revenue.”
- “It is revenue your agency cannot safely fulfil without you.”
- “Installed, operated, transferred.”
- “VBOG installs X. Your operation changes Y. The money effect is Z.”
- Use specific nouns, prices, timeframes and actions.

### Do not

- “Unlock your potential.”
- “Transform your business.”
- “Seamless, bespoke, end-to-end solutions.”
- Unsupported revenue promises.
- Cute metaphors that obscure the operating mechanism.
- Internal production labels such as “throw salt here” or “receipt here.”

## 11. Non-negotiables

- No rounded SaaS-card aesthetic.
- No purple, blue or unrelated accent colours.
- No logo filters.
- No more than one italic display phrase per headline.
- No CTA colour other than Acid or Ink.
- No claim without mechanism, evidence or qualification.
- No page that hides the price, timeframe or installation guarantee.
- No treating Revenue Refusal, Scaling as a Service and Agency Capacity Installation as three separate products.

## 12. Final preflight

Before publishing, verify:

- Correct SVG logo, unfiltered.
- Ink/Paper/Orange/Acid colour meaning is intact.
- All CTAs go to the intended destination.
- Page works at 390 px, 768 px and 1440 px.
- No horizontal scrolling.
- One clear dominant hook above the fold.
- Price, 90-day timeframe and risk reversal are visible.
- Claims include appropriate qualification.
- No draft or internal production copy is visible.
