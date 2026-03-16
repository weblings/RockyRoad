// Song library index — types, ISongLibrary abstraction, and two implementations:
//   HandleLibrary  — Chrome/Edge via File System Access API (persistent)
//   FileListLibrary — Firefox/fallback via <input webkitdirectory> (session-only)

export interface SongIndexEntry {
    folderPath: string;         // relative to library root, e.g. "boypablo/tkm"
    songName: string;
    artistName: string;
    albumName?: string;
    lengthSeconds: number;
    parts: SongIndexPart[];
}

export interface SongIndexPart {
    // Matches InstrumentType string from song.json: "LeadGuitar" | "BassGuitar" | etc.
    type: string;
    // Matches InstrumentName: "lead" | "bass" | etc. — used as the instrument .json filename.
    name: string;
    difficulty: number;
    // Tuning display string, e.g. "E Standard". Only set for stringed instruments.
    tuning?: string;
    // Raw StringSemitoneOffsets from song.json. Only set for stringed instruments.
    tuningOffsets?: number[];
}

// ── ISongLibrary ──────────────────────────────────────────────────────────────

// Abstraction over the two file-access backends. ActiveSceneScreen and
// SongLibraryScreen use only this interface — not the concrete classes.
export interface ISongLibrary {
    // Scan for all songs and return their index entries.
    scan(): Promise<SongIndexEntry[]>;
    // Get a File for a specific filename within a song's folder.
    getSongFile(entry: SongIndexEntry, filename: string): Promise<File>;
    // Get an object URL for the album art, or null if absent. Caller revokes.
    getAlbumArtUrl(entry: SongIndexEntry): Promise<string | null>;
    // True if this library can be persisted across sessions (Chrome/Edge only).
    readonly canPersist: boolean;
}

// ── Tuning helpers ────────────────────────────────────────────────────────────

export const STANDARD_BASE_NOTES: Record<number, number[]> = {
    4: [28, 33, 38, 43],               // Bass:    E A D G
    5: [23, 28, 33, 38, 43],           // Bass 5:  B E A D G
    6: [40, 45, 50, 55, 59, 64],       // Guitar:  E A D G B E
    7: [35, 40, 45, 50, 55, 59, 64],   // Guitar 7: B E A D G B E
};
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const STRINGED = new Set(['LeadGuitar', 'RhythmGuitar', 'BassGuitar']);

// Friendly names for common tunings, keyed by offsets joined with commas.
// Lookup is tried before falling back to raw note letters.
const TUNING_NAMES: Record<string, string> = {
    // 6-string guitar
    '0,0,0,0,0,0':        'E Standard',
    '-1,-1,-1,-1,-1,-1':  'Eb Standard',
    '-2,-2,-2,-2,-2,-2':  'D Standard',
    '-3,-3,-3,-3,-3,-3':  'C# Standard',
    '-4,-4,-4,-4,-4,-4':  'C Standard',
    '-2,0,0,0,0,0':       'Drop D',
    '-3,-1,-1,-1,-1,-1':  'Drop C#',
    '-4,-2,-2,-2,-2,-2':  'Drop C',
    '-5,-3,-3,-3,-3,-3':  'Drop B',
    '-6,-4,-4,-4,-4,-4':  'Drop A#',
    '-2,-2,0,0,0,-2':     'Open G',
    '-2,0,0,-1,-2,-2':    'Open D',
    '0,2,2,1,0,0':        'Open E',
    '-2,0,0,0,-2,-2':     'DADGAD',
    // 7-string guitar
    '0,0,0,0,0,0,0':      'E Standard',
    '-2,0,0,0,0,0,0':     'Drop A',
    // 4-string bass
    '0,0,0,0':            'E Standard',
    '-1,-1,-1,-1':        'Eb Standard',
    '-2,-2,-2,-2':        'D Standard',
    '-3,-3,-3,-3':        'C# Standard',
    '-4,-4,-4,-4':        'C Standard',
    '-2,0,0,0':           'Drop D',
    '-4,-2,-2,-2':        'Drop C',
    '-5,-3,-3,-3':        'Drop B',
    // 5-string bass
    '0,0,0,0,0':          'Standard',
    '-1,-1,-1,-1,-1':     'Eb Standard',
};

export function tuningDisplayString(offsets: number[]): string {
    const key = offsets.join(',');
    if (TUNING_NAMES[key]) return TUNING_NAMES[key];
    const base = STANDARD_BASE_NOTES[offsets.length];
    if (!base) return '';
    return base.map((midi, i) => NOTE_NAMES[(midi + offsets[i] + 120) % 12]).join(' ');
}

// ── Shared entry builder ──────────────────────────────────────────────────────

function entryFromJson(folderPath: string, json: Record<string, unknown>): SongIndexEntry {
    const rawParts = (json.InstrumentParts as Record<string, unknown>[] | undefined) ?? [];
    const parts: SongIndexPart[] = rawParts.map(p => {
        const type = String(p.InstrumentType ?? '');
        const tuningData = p.Tuning as { StringSemitoneOffsets?: number[] } | undefined;
        const offsets = tuningData?.StringSemitoneOffsets;
        const isStringed = STRINGED.has(type);
        return {
            type,
            name: String(p.InstrumentName ?? ''),
            difficulty: Number(p.SongDifficulty ?? 0),
            tuning:        isStringed && offsets ? tuningDisplayString(offsets) : undefined,
            tuningOffsets: isStringed && offsets ? offsets : undefined,
        };
    });
    return {
        folderPath,
        songName: String(json.SongName ?? ''),
        artistName: String(json.ArtistName ?? ''),
        albumName: json.AlbumName != null ? String(json.AlbumName) : undefined,
        lengthSeconds: Number(json.SongLengthSeconds ?? 0),
        parts,
    };
}

// ── HandleLibrary — Chrome/Edge ───────────────────────────────────────────────

export class HandleLibrary implements ISongLibrary {
    readonly canPersist = true;
    private root: FileSystemDirectoryHandle;

    constructor(root: FileSystemDirectoryHandle) {
        this.root = root;
    }

    async scan(): Promise<SongIndexEntry[]> {
        const songs: SongIndexEntry[] = [];
        await scanHandleDir(this.root, '', songs);
        return songs.sort((a, b) => a.songName.localeCompare(b.songName));
    }

    async getSongFile(entry: SongIndexEntry, filename: string): Promise<File> {
        const dir = await navigateToFolder(this.root, entry.folderPath);
        return (await dir.getFileHandle(filename)).getFile();
    }

    async getAlbumArtUrl(entry: SongIndexEntry): Promise<string | null> {
        try {
            const file = await this.getSongFile(entry, 'albumart.png');
            return URL.createObjectURL(file);
        } catch { return null; }
    }
}

// Recursively find directories containing song.json.
async function scanHandleDir(
    dir: FileSystemDirectoryHandle,
    pathSoFar: string,
    songs: SongIndexEntry[],
): Promise<void> {
    try {
        const fh = await dir.getFileHandle('song.json');
        const json = JSON.parse(await (await fh.getFile()).text());
        songs.push(entryFromJson(pathSoFar, json));
        return; // found a song here — don't descend further
    } catch { /* no song.json — recurse */ }

    for await (const [name, entry] of dir.entries()) {
        if (entry.kind !== 'directory') continue;
        const childPath = pathSoFar ? `${pathSoFar}/${name}` : name;
        await scanHandleDir(entry as FileSystemDirectoryHandle, childPath, songs);
    }
}

async function navigateToFolder(
    root: FileSystemDirectoryHandle,
    folderPath: string,
): Promise<FileSystemDirectoryHandle> {
    let dir = root;
    for (const seg of folderPath.split('/')) {
        if (seg) dir = await dir.getDirectoryHandle(seg);
    }
    return dir;
}

// ── FileListLibrary — Firefox / <input webkitdirectory> ──────────────────────

export class FileListLibrary implements ISongLibrary {
    readonly canPersist = false;
    private files: Map<string, File>; // relative path (without root segment) → File

    constructor(fileList: FileList) {
        this.files = new Map();
        for (let i = 0; i < fileList.length; i++) {
            const file = fileList[i];
            // webkitRelativePath = "rootFolderName/artist/song/file.json"
            // Strip the first segment (the picked folder's own name).
            const rel = file.webkitRelativePath.split('/').slice(1).join('/');
            this.files.set(rel, file);
        }
    }

    async scan(): Promise<SongIndexEntry[]> {
        const songs: SongIndexEntry[] = [];
        for (const [path, file] of this.files) {
            const parts = path.split('/');
            if (parts[parts.length - 1] !== 'song.json') continue;
            const folderPath = parts.slice(0, -1).join('/');
            const json = JSON.parse(await file.text());
            songs.push(entryFromJson(folderPath, json));
        }
        return songs.sort((a, b) => a.songName.localeCompare(b.songName));
    }

    async getSongFile(entry: SongIndexEntry, filename: string): Promise<File> {
        const path = entry.folderPath ? `${entry.folderPath}/${filename}` : filename;
        const file = this.files.get(path);
        if (!file) throw new Error(`File not found in library: ${path}`);
        return file;
    }

    async getAlbumArtUrl(entry: SongIndexEntry): Promise<string | null> {
        try {
            const file = await this.getSongFile(entry, 'albumart.png');
            return URL.createObjectURL(file);
        } catch { return null; }
    }
}

// ── IndexedDB handle persistence (Chrome/Edge only) ──────────────────────────
// Stores only a single key ('libraryRoot'). If this grows to multiple keys,
// consider replacing with the idb-keyval package (~1 kb).

const DB_NAME  = 'ChartPlayer';
const DB_STORE = 'handles';
const LIB_KEY  = 'libraryRoot';

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
        req.onsuccess       = () => resolve(req.result);
        req.onerror         = () => reject(req.error);
    });
}

export async function saveLibraryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put(handle, LIB_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror    = () => reject(tx.error);
    });
}

export async function loadLibraryHandle(): Promise<FileSystemDirectoryHandle | null> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx  = db.transaction(DB_STORE, 'readonly');
        const req = tx.objectStore(DB_STORE).get(LIB_KEY);
        req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) ?? null);
        req.onerror   = () => reject(req.error);
    });
}
