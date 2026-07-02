/**
 * Scans public/songs/ and writes public/songs/manifest.json.
 *
 * Each sub-directory that contains a valid song.json is included.
 * The manifest is fetched by XRProto at startup for the in-XR song library.
 *
 * Run: npx tsx tools/bake-songs.ts
 * Wired into: npm run dev / npm run build via package.json scripts.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const songsDir  = resolve(__dirname, "../public/songs");
const outPath   = resolve(__dirname, "../public/songs/manifest.json");

interface SongManifestEntry {
    folder:  string;
    title:   string;
    artist:  string;
    parts:   { name: string; type: string }[];
    hasArt:  boolean;
}

const entries: SongManifestEntry[] = [];

for (const name of readdirSync(songsDir)) {
    const dir = join(songsDir, name);
    if (!statSync(dir).isDirectory()) continue;

    const jsonPath = join(dir, "song.json");
    try {
        const raw = JSON.parse(readFileSync(jsonPath, "utf-8")) as Record<string, unknown>;
        entries.push({
            folder: name,
            title:  String(raw.SongName   ?? name),
            artist: String(raw.ArtistName ?? ""),
            parts:  (Array.isArray(raw.InstrumentParts) ? raw.InstrumentParts as Record<string, unknown>[] : [])
                        .map(p => ({
                            name: String(p.InstrumentName ?? ""),
                            type: String(p.InstrumentType ?? ""),
                        })),
            hasArt: existsSync(join(dir, "albumart.png")),
        });
    } catch {
        console.warn(`[bake-songs] Skipping ${name} — no valid song.json`);
    }
}

writeFileSync(outPath, JSON.stringify(entries, null, 2), "utf-8");
console.log(`[bake-songs] Baked ${entries.length} song(s) → ${outPath}`);
