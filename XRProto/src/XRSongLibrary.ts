import type { XrButton } from "./XRTypes.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SongManifestEntry {
    folder: string;
    title:  string;
    artist: string;
    parts:  { name: string; type: string }[];
}

// ── XRSongLibrary ─────────────────────────────────────────────────────────────

const PAGE_SIZE = 5;

export class XRSongLibrary {
    private page = 0;
    private entries: SongManifestEntry[];

    constructor(entries: SongManifestEntry[]) {
        this.entries = entries;
    }

    show(
        uiPanel: HTMLDivElement,
        xrButtons: XrButton[],
        onSelect: (entry: SongManifestEntry) => void,
    ): void {
        const totalPages = Math.max(1, Math.ceil(this.entries.length / PAGE_SIZE));
        this.page = Math.min(this.page, totalPages - 1);

        const pageEntries = this.entries.slice(
            this.page * PAGE_SIZE,
            this.page * PAGE_SIZE + PAGE_SIZE,
        );

        const rowStyle =
            'display:block;width:100%;text-align:left;padding:8px 10px;margin-bottom:6px;' +
            'background:#2a2a4a;color:#111;border:none;border-radius:5px;' +
            'font-size:13px;cursor:pointer;box-sizing:border-box';
        const navStyle =
            'padding:4px 12px;background:#3a3a5a;color:#111;border:none;' +
            'border-radius:4px;font-size:12px;cursor:pointer';

        const rowsHtml = pageEntries.map((e, i) => `
            <button id="lib-song-${i}" style="${rowStyle}">
                <div style="font-weight:bold">${esc(e.title)}</div>
                <div style="font-size:11px;color:#aaa">${esc(e.artist)}</div>
            </button>`).join('');

        const navHtml = totalPages > 1 ? `
            <div style="display:flex;justify-content:space-between;align-items:center;
                        margin-top:8px;font-size:12px;color:#aaa">
                <button id="lib-prev" style="${navStyle}">◀ Prev</button>
                <span>Page ${this.page + 1} / ${totalPages}</span>
                <button id="lib-next" style="${navStyle}">Next ▶</button>
            </div>` : '';

        uiPanel.innerHTML = `
            <div style="padding:14px;font-family:sans-serif">
                <div style="font-size:14px;font-weight:bold;color:#e8e8e8;margin-bottom:10px">
                    🎵 Song Library
                </div>
                ${this.entries.length === 0
                    ? '<div style="color:#aaa;font-size:13px">No songs found in /songs/manifest.json</div>'
                    : rowsHtml}
                ${navHtml}
            </div>
        `;

        // Register song row buttons.
        for (let i = 0; i < pageEntries.length; i++) {
            const entry = pageEntries[i];
            const el = uiPanel.querySelector(`#lib-song-${i}`) as HTMLButtonElement;
            xrButtons.push({ el, onClick: () => onSelect(entry) });
        }

        // Register prev/next buttons.
        if (totalPages > 1) {
            const prevEl = uiPanel.querySelector('#lib-prev') as HTMLButtonElement;
            const nextEl = uiPanel.querySelector('#lib-next') as HTMLButtonElement;
            xrButtons.push({
                el: prevEl,
                onClick: () => {
                    this.page = Math.max(0, this.page - 1);
                    this.show(uiPanel, xrButtons, onSelect);
                },
            });
            xrButtons.push({
                el: nextEl,
                onClick: () => {
                    this.page = Math.min(totalPages - 1, this.page + 1);
                    this.show(uiPanel, xrButtons, onSelect);
                },
            });
        }
    }
}

function esc(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
