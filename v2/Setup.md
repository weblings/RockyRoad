# Setup — ThreeCP/Combined

Environment setup for the desktop + WebXR client. For what this project is and how
it's put together, see [`README.md`](README.md).

Assumes you've already cloned the `MusicThing` repo and installed Node.js — see the
repo-root [`Setup.md`](../../Setup.md) for those steps.

---

## Install

```bash
cd ThreeCP/Combined
npm install   # first run also downloads ~100MB Playwright/Chromium for the XR emulator
```

`npm run bake` (asset baking — sprite manifest + song manifest) runs automatically
before `dev`/`build`, so no separate step is needed there. It reads
`ChartPlayerShared/Content/Textures/ImageManifest.xml` from the sibling project in
this repo, which is already present after a normal clone.

---

## HTTPS setup (required — WebXR needs a secure context)

The project uses `vite-plugin-mkcert` to issue a trusted local certificate. This
applies even when you're only using `desktop.html`, since the dev server is HTTPS
either way.

**One-time per machine** — installs a local CA into the system trust store.

**Windows:** triggers a UAC prompt — accept it.
```bash
npx mkcert -install
```

**Ubuntu:** install `libnss3-tools` and the standalone mkcert binary first:
```bash
sudo apt-get install -y libnss3-tools
curl -JLO "https://dl.filippo.io/mkcert/latest?for=linux/amd64"
chmod +x mkcert-v*-linux-amd64
sudo mv mkcert-v*-linux-amd64 /usr/local/bin/mkcert
mkcert -install
```

> **Use Chrome or Edge.** Firefox uses its own NSS certificate store and won't trust
> the mkcert CA without extra steps. Firefox also has unreliable WebXR support with
> Quest Link.

---

## Dev server

```bash
npm run dev           # desktop.html opens automatically; IWER emulator active,
                       # so an "Enter XR" button appears in the browser too
npm run dev:device    # IWER disabled — for testing with a real headset via Quest Link
```

Serves at `https://localhost:8081`. Visit `/xr.html` directly to load the WebXR entry
point in-browser (with the emulator) instead of `desktop.html`.

---

## Song library

Two small demo songs ship in `public/songs/` and are baked into a manifest
automatically, so the app works with no extra setup. To use your full song library
instead, run a second server in a separate terminal:

```bash
cp song-server.config.example.json song-server.config.json
# edit song-server.config.json: set songsDir to your local song folder root
npm run serve-songs
```

`song-server` recursively scans `songsDir` for subfolders containing a `song.json`
(any depth), and serves a generated `manifest.json` plus the raw files over HTTP(S)
with CORS enabled. Each song folder needs:

- `song.json` — `SongName`, `ArtistName`, `SongLengthSeconds`, and
  `InstrumentParts: [{ InstrumentName, InstrumentType }]`
- one chart file per instrument part, named after `InstrumentName` (e.g. `lead.json`,
  `keys.json`), in [OpenSongChart](https://github.com/mikeoliphant/OpenSongChart) format
- audio file(s) referenced by the chart data
- optional `albumart.png`

**In dev**, Vite already proxies `/remote-songs` → `http://localhost:3001`, so once
`song-server` is running, your library shows up automatically under "Library" in the
song browser — no config needed in the app itself.

**On a real headset (Quest Link/standalone) or a production build**, the browser
talks to `song-server` directly, not through the Vite proxy:

1. Set `tls: true` in `song-server.config.json`, and point `certFile`/`keyFile` at
   the mkcert cert for your machine (`npx mkcert localhost 127.0.0.1`).
2. In the app's Settings screen, set the Library URL to
   `https://<your-machine-ip>:3001`.

---

### Visit Website on Headset

Should work for any computer OS and for any headset that has a WebXR compatible browser

1. Ensure computer that will run the server and the headset are on the same wifi
2. Launch the dev server with the "device" flag (shown in Dev Server step above)
3. On the headset, open your WebXR-compatible browser and vist one of the local addresses the terminal listed when you started the dev server
4. If you are served the desktop website, click the "Enter VR" button
5. When you are served the WebXR version of the website, the browser UI should offer an option to start an immersive session

---

## Quest Link

Only relevant if your headset is a Meta Quest and your computer is running Windows

1. Meta Quest Link app → Settings → General → **Set Meta Quest Link as Active OpenXR Runtime**
2. Headset must be in Link mode (blue indicator visible inside headset)
3. Run `npm run dev:device`
4. Open `https://localhost:8081` in Chrome or Edge
5. Press **V** to launch the XR session (the IWER "Enter XR" button is absent in device mode)

---

## Machine-specific paths

`vite.config.ts` has `server.fs.allow` entries for DLC/song directories outside the
project root — the checked-in file has Windows paths (`C:/Users/...`); update these
to your local absolute paths on Ubuntu (e.g. `/home/%USER%/.../dlc`).

`.mcp.json`, `.cursor/mcp.json`, and `.codex/config.toml` are auto-managed by
IWSDK's dev tooling (IWER) and contain machine-specific `node_modules` paths —
the checked-in versions have Windows paths. IWER rewrites them on `npm run dev`, so
if AI-tool MCP integration misbehaves, that's the first thing to check; otherwise
they're safe to ignore.
