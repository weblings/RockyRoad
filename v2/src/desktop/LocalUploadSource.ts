import type { ISongSource } from "../shared/SongSource";
import type { SongIndexEntry } from "../shared/SongIndex";
import { entryFromJson } from "../shared/SongIndex";

// Demo-mode-only alternative to a real remote song server: user picks a local folder via
// <input webkitdirectory>, scanned in-session (no persistence — re-pick after reload). Adapts
// the old (dormant) HandleLibrary/FileListLibrary scanning logic in SongIndex.ts into the
// current ISongSource shape, rather than reviving that separate interface alongside this one.
export class LocalUploadSource implements ISongSource {
    readonly label = 'Uploaded Folder';

    // Relative path (folder/song, no root segment) → File. Populated once, synchronously, at
    // construction — the browser has already fully resolved the picked directory into a
    // FileList by the time the <input>'s change event fires, so this needs no async work.
    private files = new Map<string, File>();
    // Lazily filled — object URLs are only created for files something actually requests
    // (audio, chart JSON, art), not for the whole picked folder up front.
    private urls = new Map<string, string>();

    private constructor(fileList: FileList) {
        for (let i = 0; i < fileList.length; i++) {
            const file = fileList[i];
            // webkitRelativePath = "pickedFolderName/artist/song/file.json" — strip the first
            // segment (the picked folder's own name), same convention as the old FileListLibrary.
            const rel = file.webkitRelativePath.split('/').slice(1).join('/');
            this.files.set(rel, file);
        }
    }

    // Resolves null if the user cancels the picker.
    static pick(): Promise<LocalUploadSource | null> {
        return new Promise(resolve => {
            const input = document.createElement('input');
            input.type = 'file';
            input.webkitdirectory = true;
            input.addEventListener('change', () => {
                resolve(input.files?.length ? new LocalUploadSource(input.files) : null);
            }, { once: true });
            input.click();
        });
    }

    // Only song.json gets read/parsed here — arrangement.json, per-instrument part files, and
    // audio are untouched until something actually requests them via getFileUrl (i.e. once the
    // user has navigated into that specific song/instrument).
    async getManifest(): Promise<SongIndexEntry[]> {
        const entries: SongIndexEntry[] = [];
        for (const [path, file] of this.files) {
            const segments = path.split('/');
            if (segments[segments.length - 1] !== 'song.json') continue;
            const folderPath = segments.slice(0, -1).join('/');
            const entry = entryFromJson(folderPath, JSON.parse(await file.text()));
            entry.hasArt = this.files.has(this.join(folderPath, 'albumart.png'));
            entries.push(entry);
        }
        return entries;
    }

    getFileUrl(entry: SongIndexEntry, filename: string): string {
        const path = this.join(entry.folderPath, filename);
        let url = this.urls.get(path);
        if (!url) {
            const file = this.files.get(path);
            if (!file) return '';
            url = URL.createObjectURL(file);
            this.urls.set(path, url);
        }
        return url;
    }

    getAlbumArtUrl(entry: SongIndexEntry): string | null {
        return entry.hasArt ? this.getFileUrl(entry, 'albumart.png') : null;
    }

    // Not part of ISongSource — called directly by SongLibraryScreen.ts, which already holds
    // the concrete reference it needs for replace-on-re-pick bookkeeping.
    dispose(): void {
        for (const url of this.urls.values()) URL.revokeObjectURL(url);
        this.urls.clear();
    }

    private join(folderPath: string, filename: string): string {
        return folderPath ? `${folderPath}/${filename}` : filename;
    }
}
