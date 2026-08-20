# RockyRoad

- A web browser note-highway music app for guitar and piano with full support for WebXR-capable headsets
- Note-highway logic and visuals distilled from [ChartPlayer](https://github.com/mikeoliphant/ChartPlayer) into Typescript, ThreeJS, and WebXR

**To play more songs: 1) [Convert songs to OpenSongFormat](https://github.com/weblings/RockyRoadImport),
2) Self-host RockyRoad and [point its server to your converted songs](#play-your-own-songs).**

## Quick Start

Try it out with the demo songs it ships with, before bringing in your own library.

1. **Install [Node.js](https://nodejs.org/)** (the one prerequisite — version 20 or newer). This
   gives you the `node` and `npm` commands used below. One-line install, per OS:
   - **Windows:** `winget install OpenJS.NodeJS.LTS` (winget ships with Windows 10/11 already)
   - **macOS:** `brew install node` (needs [Homebrew](https://brew.sh) — if you don't have that
     yet, its own one-line installer is on that page)
   - **Linux (Debian/Ubuntu):** `sudo apt install nodejs npm` — the distro-bundled version can lag
     behind, so check `node --version` afterward and make sure it's 20+; if it's older, use
     [NodeSource's setup script](https://github.com/nodesource/distributions) instead

   Or just grab the installer for your OS from the link above if you'd rather not use a package
   manager.
2. **Get the code.** Either:
   - `git clone https://github.com/weblings/RockyRoad.git`, or
   - on the [GitHub repo page](https://github.com/weblings/RockyRoad), click the green **Code**
     button → **Download ZIP**, then unzip it — no git required. (This downloads the source code,
     not a ready-to-run app — see the FAQ below for why.)
3. **Open a terminal in the project's `v2` folder.**
4. **Run `npm install`.** This downloads the project's dependencies into a `node_modules` folder —
   one-time setup, takes a minute or two. You'll see a wall of text; that's normal.
5. **Run `npm run dev`.** This starts the app's local server. When it's ready, it prints a URL that
   looks like `https://localhost:8081/`.
6. **Open that URL in your browser.** Your browser will warn you the connection isn't "secure" —
   that's expected, not a real problem: WebXR requires HTTPS even for local testing, so the app
   generates its own certificate on the fly, and your browser doesn't recognize it yet. Click
   through the warning ("Advanced" → "Proceed") to continue.
7. **On a headset:** open the same URL's `/xr.html` page (e.g.
   `https://localhost:8081/xr.html`) from the headset's own browser — **the headset and the
   computer running the server must be on the same Wi-Fi network.** See
   [Troubleshooting](#troubleshooting) if it doesn't connect.

## Play your own songs

1. **Convert your library.** RockyRoad reads a chart format called OpenSongChart. Use
   [RockyRoadImport](https://github.com/weblings/RockyRoadImport) to convert your songs to it.
2. **Point RockyRoad at your converted songs.** In the `v2` folder, make a copy of
   `song-server.config.example.json` and rename the copy to `song-server.config.json`, then edit its `songsDir` field
   to a path pointing to the folder containing your converted songs.
3. **Restart `npm run dev`.** Your songs now show up in the library alongside the demo songs.

## Troubleshooting

**Not seeing RockyRoad in XR**
- Confirm the headset and the computer are on the **same Wi-Fi network**
- Confirm `npm run dev` is still running in its terminal — closing that window stops the server.
- Some networks/routers block devices from seeing each other by default ("client isolation" or
  "AP isolation") — check your router's settings if the above doesn't resolve it.
- A firewall on the computer running the server may need to allow the port shown in the
  `npm run dev` output (`8081` by default).

**My own songs don't show up:**
- Double-check `song-server.config.json`'s `songsDir` path — a typo means it finds nothing.
- Confirm that folder actually contains converted song folders (each with a `song.json` inside),
  not the original, unconverted files.
- Restart `npm run dev` after any change to `song-server.config.json` — it's only read at startup.

**How do I enter the Immersive App?**
- Your headset's browser needs to support WebXR (Quest / Horizon OS, Android XR, and Vision OS all should)
- When you visit the xr.html page, a button in your browser's UI should appear saying something like "Enter VR". Click that button to launch the immersive app
- The "Enter VR" button visible in RockyRoad's UI in desktop.html will not launch an Immersive app on your headset. That is a shortcut to get to xr.html.

## FAQ

**Can I play my own songs — Rocksmith 2014, piano MIDI, etc.?**
Yes — convert them first with [RockyRoadImport](https://github.com/weblings/RockyRoadImport), then
follow ["Play your own songs"](#play-your-own-songs) above.

**What's OpenSongChart / ChartPlayer / ChartConverter?**

Repos by [Mike Oliphant](https://github.com/mikeoliphant). Without this amazing tech foundation, I would not have even attempted this project!
- [OpenSongChart](https://github.com/mikeoliphant/OpenSongFormat) is an open format for song charts
- [ChartPlayer](https://github.com/mikeoliphant/ChartPlayer) is a cross-platform application for playing along to OpenSongChart charts
- [ChartConverter](https://github.com/mikeoliphant/ChartConverter) is an app for converting Rocksmith PSARC to OpenSongChart format

**Do I need to know npm or web development to use this?**
No — Quick Start above is copy-paste, with each step explained.

**Do I need a VR/XR headset?**
No. The desktop browser path (step 6 above) is the default experience; the headset/VR path is
optional.

**Why isn't there a prebuilt version I can just double-click and run?**
Two separate technical reasons, not just one: WebXR requires a secure context (HTTPS or
`localhost`), which a plain downloaded folder doesn't have on its own; and separately, the app's
code is loaded as browser "ES modules," which browsers refuse to load directly from a local file
for security reasons, regardless of WebXR. Both mean a real local server — `npm run dev` — is
needed either way, so there's no simpler prebuilt alternative today.

## For developers

For the tech stack, architecture, and directory layout, see [`v2/README.md`](v2/README.md).

For gotchas hit while building this project, see
[`Analysis/lessons/README.md`](Analysis/lessons/README.md) — written primarily for AI coding
agents working in this repo, but worth a skim if you're a human developer onboarding too.
