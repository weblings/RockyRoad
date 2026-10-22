# 0.3.0 release prep and XR Library fixes

Id: 2026-10-22-v0-3-0-release-prep
Status: closed 2026-10-22 on `feat/0.3.0Prep`. Not yet merged to `dev`/`main`, `v0.3.0` tag to be made from GitHub Releases.

Version bump and a Library version footer, plus the XR Library scroll and clipping bugs found while
testing it with placeholder songs. Bead RockyRoad-211.

## What landed

- Version 0.3.0 in `package.json` and the lockfile, CHANGELOG `v0.3.0` entry. The `v0.2.5` branch was
  renamed `release/0.2.5` (old branch deleted on origin, the `v0.2.5` tag untouched).
- `__APP_VERSION__` defined in `vite.config.ts` from `package.json`, typed in `src/shared/globals.d.ts`.
- Desktop Library ribbon always shows the version, "View Source Code" stays demo-only.
- XR Library footer row in `ui/library.uikitml`, 4.2 tall, opaque, `z-index: 5`, toolbar opaque and
  `z-index: 5` too. The 4.2 height is deliberate, see the Image-clipping entry in
  [[lesson-uikit-scrolling-and-dropdowns]]. Costs about 1.6 units of list height.
- Dev toggles: `VITE_FAKE_SONGS` / `?fakeSongs=N` adds placeholder songs, `VITE_DEBUG` / `?debug=a,b`
  replaces the `DEBUG_FEATURES` and `DEBUG_CONSOLE_ENABLED` consts, both settable in a git-ignored
  `.env.local`. `dev:fake` and `dev:device:fake` scripts. Documented in `Setup.md`.
- `library` debug feature: list layout watcher (logs on change every 500 ms) and per-card pointer events.
- XR Library fixes:
  - Scroll stalled after about 5 units: `onScroll` clears uikit's was-scrolled flag from the shared
    native event (`clearWasScrolled()`).
  - Rows stopped at the first 12 after returning from a song: row batches use `setTimeout` instead of
    `requestAnimationFrame`, which stalls in an XR session.
  - Releasing a scroll drag opened the card under the pointer: clicks are swallowed after 1.5 cm of
    pointer travel.
  - Thumbnails and icons drawing over the toolbar and footer: opaque `z-index` strips, see above.

## Verification (observed 2026-10-22)

- `npm run build` and `npm run build:demo` pass, and `dist/` contains none of the dev-only code.
- Headset, with 30 placeholder songs: scrolling reached the end of the list, all rows were back after
  selecting and leaving a song, no card opened after a scroll drag, and the toolbar and footer strips
  hid overflowing images. The 4.2 footer was kept after being tried.

## Findings

- Stall log: position stopped at 6.5 and 7.8 (just past 5), scroll max was a correct 38.3, `down`
  returned to 0 after every press, and each press carried 16 to 176 moves. That ruled out layout
  corruption and the capture wedge.
- Rows log: `rows` read 12 for about 7 s after returning, then 36 and 37.
- Clip probe (temporary, removed): the Root matrix was identity and parent scale 1, so the image clip
  planes were already correct in world space (positive inside, negative outside).

## Dead ends

- `renderer.localClippingEnabled = true`: odd rendering (the thumbnail's grey background showing) and
  no clip at the footer, reverted.
- `overflow: hidden` on `.song-entry`: no visible change, reverted.
- Missing Root matrix in uikit's `RelativePlane` as the cause: refuted by the probe.
- A version pill at the bottom or in the toolbar: discussed, not built. A bottom pill would not hide
  overflow and would cover cards.

## Open

- Why the flag gave a grey thumbnail is unexplained. Untried: the flag with the thumbnail's own
  `overflow: hidden` removed, and hiding each card's images by scroll position (would let the footer
  shrink back to about 2.6).
- `.codex/config.toml` and `public/songs/manifest.json` show as modified (line endings) and were left out.
