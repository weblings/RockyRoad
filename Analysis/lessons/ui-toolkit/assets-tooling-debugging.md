# uikit/uikitml — assets, tooling, and debugging

Icons/images, the compile pipeline, and workflow gotchas specific to `.uikitml`. See
[`INDEX.md`](INDEX.md) for the full ui-toolkit map.

---

## `<img src="....svg">` is the safe way to embed a real (non-rasterized) SVG icon

**Symptom:** Need to reproduce an existing SVG icon (e.g. a back-arrow chevron) inside a
`.uikitml` panel.

**Finding:** `@pmndrs/uikitml`'s parser auto-detects `<img src="...">` where the `src` ends in
`.svg` and compiles it as a real vector `Svg` component (`type: "svg"`), not a rasterized image.
This is much lower-risk than authoring raw `<svg>...</svg>` or `<inline-svg>` markup directly in
`.uikitml` text — the interpreter does support those tags too (`svg`/`inline-svg` cases exist),
but embedding a real SVG's nested `<path>` tags inside `.uikitml`'s own HTML-like text parser
risks the parser trying to interpret them as its own elements. `<img src="/icon.svg">` sidesteps
that entirely — the SVG is fetched and parsed by the `Svg` component's own (separate, standard)
SVG parsing, not uikitml's text parser.

**Fix:** Save the icon as a standalone `.svg` file in `public/`, reference via
`<img src="/name.svg" class="...">`. Bake any needed fill color directly into the SVG file's own
`fill="#..."` attribute rather than relying on CSS `currentColor`-style inheritance, which isn't
confirmed to work the same way here.

---

## `.uikitml` → JSON is fetched once per page load, with no cache-busting

**Symptom:** Edited `.uikitml`, the dev server's file watcher recompiled it (visible in the
terminal), but the running app still shows the old content even after what looks like a reload.

**Root cause:** `PanelUISystem.loadPanel()` does a plain `fetch(config)` against
`/ui/<name>.json` with no cache-busting query param, and only loads it **once** per entity, ever
— editing the source file after that entity's already loaded has zero effect on the running
session. Compounding this, the browser's own HTTP cache can also serve a stale response even on
a normal reload.

**Fix:** After editing a `.uikitml` file, do a **hard reload** (Ctrl+Shift+R), not a normal one.
If still stale, the app itself likely needs a full restart (not just a page reload) if the
in-memory entity already has a loaded `PanelDocument`.

---

## No separate "missing image" placeholder element needed — just hide the `<img>`

**Finding (from Song/PreScene's album art):** when there's no image to show (e.g. a song with no
album art), don't author a second placeholder `<div>` and toggle between it and the `<img>`. Just
set `display: 'none'` on the `<img>` itself and let its parent container's own background color
show through — that's usually visually identical to a dedicated placeholder anyway, with half the
markup and no extra display-toggle bookkeeping. Set the real `src` and flip `display: 'flex'` back
on once a URL is available. See `XRPreScene.ts`'s `_render()` for the working pattern.

---

## An SVG's `fill="currentColor"` breaks uikit's image loader

**Symptom:** Console error, "currentColor doesn't exist" (not a silent failure this time).

**Root cause:** `currentColor` requires real CSS-cascade context to resolve against — uikit's
standalone SVG parsing has none. Every other icon already in this project uses a literal
`fill="#ffffff"` instead (confirmed by checking `back-arrow.svg`/`settings-gear-icon.svg`).

**Fix:** Any new icon SVG must use a literal hex fill, never `currentColor`. Same category as the
missing-glyph character list in `text-rendering.md` — check for this on sight before wiring in a
new icon, don't wait for the bug report.

---

## `@pmndrs/uikit`'s `Image` defaults to `keepAspectRatio: true`, which reflows the element after its texture loads — fighting an explicit fixed-size CSS rule

**Symptom:** A library row's album-art thumbnail and its neighboring text padding intermittently
looked wrong, timing-dependent on when the row's image finished loading — no static CSS change
fixed it reliably.

**Root cause:** Confirmed by reading `@pmndrs/uikit`'s actual `Image` component source
(`node_modules/@pmndrs/uikit/dist/components/image.js`): `keepAspectRatio` defaults to `true`, and
an internal signal only resolves the real image's aspect ratio once its `TextureLoader.loadAsync()`
call finishes — asynchronously, per element, on its own schedule. That resolved ratio then adjusts
the element's box size to match, even when the `.uikitml` CSS gives it an explicit fixed
`width`/`height` — so the box silently resizes itself the moment the texture loads, regardless of
what the authored CSS says.

**Fix:** Pass `keepAspectRatio: false` explicitly on any `Image` where a fixed CSS size (with
`objectFit: 'cover'`/`'fill'`) is the actual intent — don't rely on the default, and don't assume an
explicit CSS width/height alone is authoritative for this component.

---

## `compileUIKit` plugin crashes the dev server if the `.uikitml` source directory is missing

**Symptom:** `npm run dev` starts but no page loads at all — not just the uikit screens, everything.

**Root cause:** `compileUIKit({ sourceDir: "ui" })` in `vite.config.ts` expects that directory to
exist at project root. If it's absent, the plugin throws during Vite startup, silently preventing
any page from being served — the failure mode gives no hint that a missing uikit source folder is
the cause of an apparently unrelated total outage.

**Fix:** Ensure the `.uikitml` source directory (and any assets the compiled panels reference,
e.g. sprite sheets/icons) exist before first `npm run dev` in a fresh checkout or after a project
restructure.
