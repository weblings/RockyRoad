import type { Entity, UIKitDocument } from "@iwsdk/core";
import { PanelDocument, UIKit } from "@iwsdk/core";
import type { SourcedEntry } from "../shared/SongSource";
import { BADGE_LABELS } from "../shared/InstrumentSelect";

// uikit-based (see ui/library.uikitml), migrated off html2canvas — same idiom as
// XRSettingsScene.ts/XRActiveScene.ts: poll for the PanelDocument once, then wire
// onClick/setProperties per element on every _render().
//
// Search is intentionally inert — no onClick on #lib-search-display, no real <input>.
// No OS keyboard is reachable from an active WebXR session, and no fix exists at the
// IWSDK/browser level; real fix is a future on-screen uikit keyboard (tracked as a
// follow-up, not a retrospective lesson).
// searchQuery/_getFiltered() are kept as-is (always '') so that follow-up only wires input.

const SORT_OPTIONS = [
    { value: 'title-asc',       label: 'Title A-Z' },
    { value: 'title-desc',      label: 'Title Z-A' },
    { value: 'artist-asc',      label: 'Artist A-Z' },
    { value: 'artist-desc',     label: 'Artist Z-A' },
    { value: 'difficulty-asc',  label: 'Difficulty Low-High' },
    { value: 'difficulty-desc', label: 'Difficulty High-Low' },
    { value: 'tuning-asc',      label: 'Tuning A-Z' },
] as const;

type SortValue = (typeof SORT_OPTIONS)[number]['value'];

// Rows append a few frames at a time, not all at once — avoids a confirmed Yoga bug
// where a burst of brand-new text glyphs corrupts an unrelated element's layout
// elsewhere in the doc (see ThreeCP/Analysis/lessons/ui-toolkit/text-rendering.md).
const ROW_BATCH_SIZE = 12;

function truncate(s: string, max: number): string {
    return s.length > max ? s.slice(0, max - 3) + '...' : s;
}

type UIKitContainer = InstanceType<typeof UIKit.Container>;

export class XRSongLibrary {
    private entries: SourcedEntry[];
    private sortKey: SortValue = 'title-asc';
    private filterKey: 'all' | 'lead' = 'all';
    private sortOpen = false;
    private searchQuery = '';

    private _doc: UIKitDocument | null = null;
    private _rowNodes: UIKitContainer[] = [];
    private _rebuildToken = 0;

    constructor(entries: SourcedEntry[]) {
        this.entries = entries;
    }

    show(panelEntity: Entity, onSelect: (sourced: SourcedEntry) => void): void {
        const proceed = (doc: UIKitDocument) => {
            this._doc = doc;
            // Library shows at boot, racing index.ts's setLibraryPanelInteractive(true) call
            // (reads PanelDocument synchronously, no-ops if not ready yet) — set it here
            // instead, guaranteed to apply now that doc is confirmed real.
            doc.rootElement.setProperties({ pointerEvents: 'auto' });
            this._render(doc, onSelect);
        };

        if (this._doc) { proceed(this._doc); return; }

        const poll = () => {
            const doc = panelEntity.getValue(PanelDocument, 'document') as UIKitDocument | null;
            if (doc) { proceed(doc); return; }
            setTimeout(poll, 100);
        };
        poll();
    }

    private _render(doc: UIKitDocument, onSelect: (sourced: SourcedEntry) => void): void {
        const rerender = () => this._render(doc, onSelect);

        // ── Sort dropdown ────────────────────────────────────────────────────
        const currentLabel = SORT_OPTIONS.find(o => o.value === this.sortKey)?.label ?? 'Title A-Z';
        doc.getElementById('sort-label')?.setProperties({ text: currentLabel });
        doc.getElementById('sort-menu')?.setProperties({ display: this.sortOpen ? 'flex' : 'none' });
        doc.getElementById('sort-chevron-down')?.setProperties({ display: this.sortOpen ? 'none' : 'flex' });
        doc.getElementById('sort-chevron-up')?.setProperties({ display: this.sortOpen ? 'flex' : 'none' });
        doc.getElementById('sort-trigger')?.setProperties({
            onClick: () => { this.sortOpen = !this.sortOpen; rerender(); },
        });

        for (const opt of SORT_OPTIONS) {
            const el = doc.getElementById(`sort-opt-${opt.value}`);
            if (!el) continue;
            this._setSelectedClass(el, opt.value === this.sortKey);
            el.setProperties({
                onClick: () => { this.sortKey = opt.value; this.sortOpen = false; rerender(); },
            });
        }

        // ── Filter row ───────────────────────────────────────────────────────
        this._setFilterClass(doc.getElementById('filter-all'),  this.filterKey === 'all');
        this._setFilterClass(doc.getElementById('filter-lead'), this.filterKey === 'lead');
        doc.getElementById('filter-all')?.setProperties({
            onClick: () => { this.filterKey = 'all'; rerender(); },
        });
        doc.getElementById('filter-lead')?.setProperties({
            onClick: () => { this.filterKey = 'lead'; rerender(); },
        });

        // ── Exit ─────────────────────────────────────────────────────────────
        doc.getElementById('exit-vr')?.setProperties({
            onClick: () => { location.href = 'desktop.html'; },
        });

        // ── Search (display-only — see file header) ─────────────────────────
        const searchTextEl = doc.getElementById('lib-search-text');
        searchTextEl?.setProperties({ text: this.searchQuery || 'Search...' });
        if (searchTextEl) {
            const addClass = this.searchQuery ? 'search-text' : 'search-placeholder';
            const removeClass = this.searchQuery ? 'search-placeholder' : 'search-text';
            if (searchTextEl.classList.contains(removeClass)) searchTextEl.classList.remove(removeClass);
            if (!searchTextEl.classList.contains(addClass)) searchTextEl.classList.add(addClass);
        }

        // ── Song list ────────────────────────────────────────────────────────
        const list = doc.getElementById('lib-song-list') as UIKitContainer | null;
        if (list) this._rebuildRows(list, this._getFiltered(), onSelect);
    }

    // classList.remove() warns if the class isn't currently present — guard
    // with contains() first, same pattern as XRSettingsScene.ts's
    // _setActiveClass()/_setSwatch().
    private _setSelectedClass(el: ReturnType<UIKitDocument['getElementById']>, selected: boolean): void {
        if (!el) return;
        if (selected) {
            if (!el.classList.contains('sort-option-selected')) el.classList.add('sort-option-selected');
        } else {
            if (el.classList.contains('sort-option-selected')) el.classList.remove('sort-option-selected');
        }
    }

    private _setFilterClass(el: ReturnType<UIKitDocument['getElementById']>, active: boolean): void {
        if (!el) return;
        const addClass = active ? 'primary-light' : 'primary-dark';
        const removeClass = active ? 'primary-dark' : 'primary-light';
        if (el.classList.contains(removeClass)) el.classList.remove(removeClass);
        if (!el.classList.contains(addClass)) el.classList.add(addClass);
    }

    private _rebuildRows(
        list: UIKitContainer,
        entries: SourcedEntry[],
        onSelect: (sourced: SourcedEntry) => void,
    ): void {
        for (const node of this._rowNodes) list.remove(node);
        this._rowNodes = [];

        const token = ++this._rebuildToken;
        let i = 0;

        const appendBatch = (): void => {
            // A newer rebuild (filter/sort changed again) superseded this one.
            if (token !== this._rebuildToken) return;
            const end = Math.min(i + ROW_BATCH_SIZE, entries.length);
            for (; i < end; i++) {
                const row = this._buildRow(entries[i], onSelect);
                list.add(row);
                this._rowNodes.push(row);
            }
            if (i < entries.length) requestAnimationFrame(appendBatch);
        };
        appendBatch();
    }

    private _buildRow(sourced: SourcedEntry, onSelect: (sourced: SourcedEntry) => void): UIKitContainer {
        const row = new UIKit.Container({ onClick: () => onSelect(sourced) }, ['song-entry']);

        const artThumb = new UIKit.Container({}, ['song-art-thumb']);
        const artUrl = sourced.source.getAlbumArtUrl(sourced.entry);
        // No separate placeholder element — same pattern as song.uikitml's
        // #ps-art-img: only add the <img> when there's a real URL, otherwise
        // let .song-art-thumb's own background color show through.
        if (artUrl) {
            artThumb.add(new UIKit.Image({ src: artUrl }, ['song-art-image']));
        }
        row.add(artThumb);

        const meta = new UIKit.Container({}, ['song-meta']);
        meta.add(new UIKit.Text({ text: truncate(sourced.entry.songName, 20) },   ['song-title']));
        meta.add(new UIKit.Text({ text: truncate(sourced.entry.artistName, 24) }, ['song-artist']));
        row.add(meta);

        const partTypes = new Set(sourced.entry.parts.map(p => p.type));
        const badges = BADGE_LABELS.filter(b => b.types.some(t => partTypes.has(t)));
        if (badges.length) {
            const badgeRow = new UIKit.Container({}, ['song-badges']);
            for (const b of badges) badgeRow.add(new UIKit.Text({ text: b.label }, ['song-badge']));
            row.add(badgeRow);
        }

        return row;
    }

    private _getFiltered(): SourcedEntry[] {
        const q = this.searchQuery.toLowerCase();
        let filtered = this.filterKey === 'lead'
            ? this.entries.filter(s => s.entry.parts.some(p => p.type === 'Keys'))
            : this.entries;
        if (q) {
            filtered = filtered.filter(s => {
                const hay = `${s.entry.songName} ${s.entry.artistName} ${s.entry.albumName ?? ''}`.toLowerCase();
                return hay.includes(q);
            });
        }
        return this._sorted(filtered);
    }

    private _sorted(entries: SourcedEntry[]): SourcedEntry[] {
        const copy = [...entries];
        switch (this.sortKey) {
            case 'title-asc':       copy.sort((a, b) => a.entry.songName.localeCompare(b.entry.songName));     break;
            case 'title-desc':      copy.sort((a, b) => b.entry.songName.localeCompare(a.entry.songName));     break;
            case 'artist-asc':      copy.sort((a, b) => a.entry.artistName.localeCompare(b.entry.artistName)); break;
            case 'artist-desc':     copy.sort((a, b) => b.entry.artistName.localeCompare(a.entry.artistName)); break;
            default:                copy.sort((a, b) => a.entry.songName.localeCompare(b.entry.songName));     break;
        }
        return copy;
    }
}
