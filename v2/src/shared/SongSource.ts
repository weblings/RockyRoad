import type { SongIndexEntry } from './SongIndex';

// ── ISongSource ───────────────────────────────────────────────────────────────

export interface ISongSource {
    readonly label: string;
    getManifest(): Promise<SongIndexEntry[]>;
    getFileUrl(entry: SongIndexEntry, filename: string): string;
    getAlbumArtUrl(entry: SongIndexEntry): string | null;
}

export interface SourcedEntry {
    entry:  SongIndexEntry;
    source: ISongSource;
}

// ── Manifest wire format (baked + remote server both emit this shape) ─────────

interface ManifestEntry {
    folder:  string;
    title:   string;
    artist:  string;
    parts:   { name: string; type: string }[];
    hasArt?: boolean;
}

function fromManifest(e: ManifestEntry): SongIndexEntry {
    return {
        folderPath:    e.folder,
        songName:      e.title,
        artistName:    e.artist,
        lengthSeconds: 0,
        parts: e.parts.map(p => ({ type: p.type, name: p.name, difficulty: 0 })),
        hasArt: e.hasArt ?? false,
    };
}

// ── BakedSource — always-available demo songs bundled in public/songs/ ────────

export class BakedSource implements ISongSource {
    readonly label = 'Demo Songs';

    async getManifest(): Promise<SongIndexEntry[]> {
        const resp = await fetch('/songs/manifest.json');
        if (!resp.ok) return [];
        return (await resp.json() as ManifestEntry[]).map(fromManifest);
    }

    getFileUrl(entry: SongIndexEntry, filename: string): string {
        return `/songs/${encodeURI(entry.folderPath)}/${filename}`;
    }

    getAlbumArtUrl(entry: SongIndexEntry): string | null {
        if (!entry.hasArt) return null;
        return `/songs/${encodeURI(entry.folderPath)}/albumart.png`;
    }
}

// ── RemoteSource — user-configured song server accessed by URL ────────────────

export class RemoteSource implements ISongSource {
    readonly label: string;
    private readonly base: string;

    constructor(label: string, baseUrl: string) {
        this.label = label;
        this.base  = baseUrl.replace(/\/$/, '');
    }

    async getManifest(): Promise<SongIndexEntry[]> {
        const resp = await fetch(`${this.base}/manifest.json`);
        if (!resp.ok) throw new Error(`Remote library returned HTTP ${resp.status}`);
        return (await resp.json() as ManifestEntry[]).map(fromManifest);
    }

    getFileUrl(entry: SongIndexEntry, filename: string): string {
        return `${this.base}/${encodeURI(entry.folderPath)}/${filename}`;
    }

    getAlbumArtUrl(entry: SongIndexEntry): string | null {
        if (!entry.hasArt) return null;
        return `${this.base}/${encodeURI(entry.folderPath)}/albumart.png`;
    }
}

// ── Helper: build a SourcedEntry[] from settings ─────────────────────────────

const DEV_DEFAULT_REMOTE = '/remote-songs';

export async function loadAllSources(remoteServerUrl: string): Promise<SourcedEntry[]> {
    const sources: ISongSource[] = [new BakedSource()];
    const effectiveUrl = remoteServerUrl || (import.meta.env.DEV ? DEV_DEFAULT_REMOTE : '');
    if (effectiveUrl) sources.push(new RemoteSource('Library', effectiveUrl));

    const results = await Promise.allSettled(sources.map(s => s.getManifest()));
    const entries: SourcedEntry[] = [];
    for (let i = 0; i < sources.length; i++) {
        const r = results[i];
        if (r.status === 'fulfilled') {
            for (const entry of r.value) entries.push({ entry, source: sources[i] });
        } else {
            console.warn(`[SongSource] Failed to load "${sources[i].label}":`, r.reason);
        }
    }
    return entries;
}
