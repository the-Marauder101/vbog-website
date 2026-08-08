# design-sync notes — vbog-website

## Shape

- This repo is a **static HTML/CSS site, not a component library**. No `package.json`,
  no build, no bundler, no Storybook, no React anywhere. The standard converter
  (`package-build.mjs`) cannot run here — there is no `dist/` to bundle.
- The sync target is therefore a **tokens-only design system** (base SKILL.md permits
  this; non-storybook SKILL.md "Known limitations" names it explicitly:
  *"Tokens-only DS (no components): emits styles.css only with an empty-bodied
  `_ds_bundle.js`"*). The kit was hand-produced into `design-kit/` and is committed —
  it is the deliverable, not regenerated build output, so it is NOT gitignored.
- `design-kit/_ds_bundle.js` is deliberately empty-bodied. Do not "fix" it.

## Upload

- **`DesignSync` could not authorize in this environment** (claude.ai/code remote
  session — `/design-login` needs an interactive terminal). Nothing was uploaded.
  The tool's own guidance: use Claude Design's "Send to Claude Code Web" to seed the
  project into the workspace, or upload `design-kit/` contents directly.
- No `projectId` is recorded yet. Whoever completes the upload should add it to
  `config.json` so future syncs anchor to the same project.

## Source of truth

- `capacity sprint/VBOG_BRAND_KIT.md` is the brand specification. It is copied
  verbatim into `design-kit/guidelines/vbog-brand-kit.md` — do not paraphrase it in
  two places; re-copy on change.
- Class implementations were extracted from `capacity sprint/assets/revenue-refusal.css`,
  which is the only file that implements the kit palette exactly.

## Brand drift (unresolved, flagged for the owner)

The repo contains **two brand generations**. The owner confirmed the brand-kit
palette is canonical, but the other one still dominates the codebase:

| Palette | Ink | Orange | Paper | Files |
|---|---|---|---|---|
| Brand kit (canonical) | `#111510` | `#f45b2f` | `#f4efe3` | ~7 |
| Site brand | `#0a0a0a` | `#ff4d00` | `#f7f5f2` | ~28 |

Also divergent *within* the canonical generation:

- `revenue-refusal.css` (`--r3-*`) — exact match to the kit.
- `scaling-service.css` (`--saas-*`) — ink is `#101510`, not `#111510`.
- `agency-capacity.css` (unprefixed) — drifted: `#171714` / `#e84a1b` / `#f4f0e7`.
- The kit's own `--vbog-*` names from §4 are used in **zero** files.

Migrating those pages onto `design-kit/tokens/` is the follow-up that makes the
design system real in the codebase rather than only in Claude Design.

## Known render warns

- `.vbog-receipt-tear` renders the torn edge as a repeating-gradient dashed strip.
  It reads as a perforation, not a true torn edge. Acceptable; revisit if the owner
  wants the real jagged mask.

## Re-sync risks

- **The brand kit doc can drift from `guidelines/` and `tokens/`.** Nothing enforces
  the copy. On re-sync, diff `capacity sprint/VBOG_BRAND_KIT.md` against
  `design-kit/guidelines/vbog-brand-kit.md` and re-copy, then re-check that the §4
  hex values still match `tokens/colors.css`.
- **`conventions.md` enumerates class and token names** that are inlined into the
  design agent's system prompt. If `vbog-base.css` is edited, re-run the name
  validation (grep each claimed `.vbog-*` class and `--vbog-*` token against the CSS)
  before shipping — a named-but-absent class silently produces unstyled output.
- **Verification here was a real headless-chromium render**, not the standard
  `package-validate.mjs` (which needs a bundle that does not exist). The demo page is
  `design-kit/preview.html`; re-screenshot it after any CSS change. Three bugs were
  caught this way that name-checking alone missed — light cards inheriting a dark
  section's text colour, and `.vbog-forest` missing the dark-surface overrides.
- Fonts are all **system stacks** (Georgia / Arial / mono) — no webfonts ship and none
  are needed, so `[FONT_MISSING]` is not applicable here.
