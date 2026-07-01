/**
 * Song server — serves a local songs directory over HTTP(S) with CORS.
 *
 * Config: song-server.config.json in the project root (copy from example).
 * Run:    npm run serve-songs
 *
 * TLS (for Quest over WiFi / standalone HTTPS):
 *   1. Run: npx mkcert localhost 127.0.0.1
 *   2. Set tls: true in song-server.config.json
 *   3. Set certFile / keyFile to the generated filenames (default: localhost.pem / localhost-key.pem)
 *
 * Proxy mode (dev only, no TLS needed):
 *   1. Leave tls: false
 *   2. The Vite dev server proxies /remote-songs → http://localhost:3001
 *   3. Enter http://localhost:8081/remote-songs in the app's Library URL field
 */

import { createServer as httpServer }  from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────

interface Config {
    songsDir: string;
    port:     number;
    tls:      boolean;
    certFile?: string;
    keyFile?:  string;
}

const configPath = resolve(process.cwd(), 'song-server.config.json');
if (!existsSync(configPath)) {
    console.error('[song-server] song-server.config.json not found.');
    console.error('[song-server] Copy song-server.config.example.json and fill in your songs directory.');
    process.exit(1);
}
const cfg: Config = JSON.parse(readFileSync(configPath, 'utf-8'));
const songsDir = resolve(cfg.songsDir);

if (!existsSync(songsDir)) {
    console.error(`[song-server] songsDir not found: ${songsDir}`);
    process.exit(1);
}

// ── Song scan ─────────────────────────────────────────────────────────────────

interface ManifestEntry {
    folder: string;
    title:  string;
    artist: string;
    parts:  { name: string; type: string }[];
}

function scanDir(dir: string, entries: ManifestEntry[]): void {
    const jsonPath = join(dir, 'song.json');
    if (existsSync(jsonPath)) {
        try {
            const raw = JSON.parse(readFileSync(jsonPath, 'utf-8')) as Record<string, unknown>;
            entries.push({
                folder: relative(songsDir, dir).replace(/\\/g, '/'),
                title:  String(raw.SongName   ?? ''),
                artist: String(raw.ArtistName ?? ''),
                parts:  (Array.isArray(raw.InstrumentParts)
                    ? (raw.InstrumentParts as Record<string, unknown>[])
                    : []
                ).map(p => ({
                    name: String(p.InstrumentName ?? ''),
                    type: String(p.InstrumentType ?? ''),
                })),
            });
        } catch {
            console.warn(`[song-server] Skipping ${dir} — bad song.json`);
        }
        return;
    }
    for (const name of readdirSync(dir)) {
        const child = join(dir, name);
        if (statSync(child).isDirectory()) scanDir(child, entries);
    }
}

const manifest: ManifestEntry[] = [];
scanDir(songsDir, manifest);
console.log(`[song-server] Found ${manifest.length} song(s) in ${songsDir}`);

// ── MIME types ────────────────────────────────────────────────────────────────

const MIME: Record<string, string> = {
    '.json': 'application/json',
    '.ogg':  'audio/ogg',
    '.mp3':  'audio/mpeg',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
};

const CORS_HEADERS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

// ── Request handler ───────────────────────────────────────────────────────────

function handler(req: IncomingMessage, res: ServerResponse): void {
    if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
    }

    const url = decodeURIComponent(req.url ?? '/');

    // Manifest endpoint
    if (url === '/manifest.json') {
        const body = JSON.stringify(manifest);
        res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
        res.end(body);
        return;
    }

    // Static file — resolve relative to songsDir, block path traversal
    const filePath = resolve(songsDir, '.' + url);
    if (!filePath.startsWith(songsDir)) {
        res.writeHead(403, CORS_HEADERS);
        res.end('Forbidden');
        return;
    }

    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
        res.writeHead(404, CORS_HEADERS);
        res.end('Not found');
        return;
    }

    const mime = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': mime });
    createReadStream(filePath).pipe(res);
}

// ── Start server ──────────────────────────────────────────────────────────────

const proto = cfg.tls ? 'https' : 'http';

const server = cfg.tls
    ? httpsServer({
        cert: readFileSync(resolve(cfg.certFile ?? 'localhost.pem')),
        key:  readFileSync(resolve(cfg.keyFile  ?? 'localhost-key.pem')),
    }, handler)
    : httpServer(handler);

server.listen(cfg.port, () => {
    console.log(`[song-server] ${proto}://localhost:${cfg.port}`);
    if (!cfg.tls) {
        console.log(`[song-server] In dev: use http://localhost:8081/remote-songs as the Library URL`);
        console.log(`[song-server] (Vite proxies /remote-songs → http://localhost:${cfg.port})`);
    }
});
