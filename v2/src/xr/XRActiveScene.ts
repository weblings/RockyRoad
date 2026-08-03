import type { Entity, UIKitDocument } from "@iwsdk/core";
import { PanelDocument, UIKit } from "@iwsdk/core";
import type { Vector3 } from "three";
import type { SongPlayer } from "../shared/SongPlayer";
import type { SongSection } from "../shared/SongFormat";

// ── XRActiveScene ─────────────────────────────────────────────────────────────
// uikit-based (see ui/play.uikitml) — migrated off html2canvas following the
// same pattern as XRSettingsScene.ts/XRPreScene.ts. Unlike those two, this
// screen also has content that updates every frame while showing (play/pause
// state, seek position, elapsed time) — handled by a separate per-frame
// method wired through the same registerPanelUpdate hook the old DOM-based
// version used, rather than the click-triggered _render()/rerender() path.

// uikit's own PointerEvent type lives in @pmndrs/pointer-events, not a direct
// dependency of this project (only transitive via @iwsdk/core) — this local
// shape covers the fields the seek-drag handlers need. setPointerCapture/
// releasePointerCapture are real methods @pmndrs/pointer-events attaches to
// interactive Object3Ds (node_modules/@pmndrs/pointer-events/dist/pointer.d.ts) —
// capturing on pointerdown is what makes onPointerMove/onPointerUp keep firing
// even once the ray/hand drags outside the seek track's actual bounds,
// instead of only while directly hovering it.
//
// Deliberately NOT using event.localPoint here, even though it's tempting —
// it's relative to whichever sub-element the ray/hand actually hit first
// (the thumb, the fill bar, a section tick, or the track itself all sit at
// different positions *within* the track), so the reference frame silently
// changes depending on what you happened to grab. @pmndrs/uikit's own
// scrollbar-drag code (node_modules/@pmndrs/uikit/dist/scroll.js's
// setupScrollHandlers) doesn't trust it for the same reason — it explicitly
// calls `container.worldToLocal(event.point.clone())` against the known,
// stable container instead. This file does the same against `track`
// specifically (captured once in _wireSeekDrag), not whatever `event.object`
// happened to be. `event.point` is world-space (unambiguous regardless of
// what was hit), confirmed via @pmndrs/pointer-events/dist/event.d.ts.
//
// What's still true from the earlier investigation: this local space is
// normalized to the element's own size and centered at its middle, not raw
// absolute units — confirmed by scroll.js's getIntersectedScrollbarIndex,
// which does `point.x *= size[0]` to convert this same local coordinate into
// absolute cm units, and by computeScrollbarTransformation's use of
// `size[i] * 0.5` as the edge boundary. So a local x of 0 is the track's
// center, ±0.5 its edges — `localPoint.x + 0.5` is the 0-1 fraction along
// its width, no division by size needed.
type WorldPointerEvent = {
    point?: Vector3;
    pointerId: number;
    currentTarget?: {
        setPointerCapture?(pointerId: number): void;
        releasePointerCapture?(pointerId: number): void;
    };
};

const MAX_TITLE_CHARS    = 26;
const MAX_SUBTITLE_CHARS = 30;

// Note-hit streak/total-notes tracking doesn't exist anywhere in the XR port
// yet (see NoteDetector/Stretch Goal B in the project plan) and a live
// in-play Difficulty control has no backing concept either (SongFormat.
// SongDifficulty is static per-song metadata, used for Library sorting, not
// an adjustable runtime value). Both rows are built in ui/play.uikitml
// against the target design already, just gated fully off here until the
// real features land — flip these consts, no markup changes needed.
const STATS_ROW_ENABLED = false;
const DIFFICULTY_ENABLED = false;

// Matches the preset list desktop's speed control generates (see
// SPEED_PRESET_STEP in src/desktop/ActiveSceneScreen.ts) — 20% steps from
// 20% to 200%. Unlike desktop, XR has no separate fine +/-0.05 stepper
// alongside the dropdown (the v0.2.2 design only shows a single trigger), so
// this is the full range of values reachable here.
const SPEED_PRESETS = [0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0];

// Mirror of .option-item/.option-menu-inner/.option-menu's layout in
// ui/play.uikitml, used to compute where to scroll the dropdown to on open
// WITHOUT reading live .size/.relativeCenter signals — confirmed in-headset
// that those read [0,0] at the exact synchronous moment display flips to
// 'flex' (Yoga hasn't laid out the newly-visible subtree yet), and even a
// short handful of setTimeout retries didn't reliably outlast that. Since
// this menu's item count/sizing is fixed and entirely authored by us, there
// is no live measurement actually needed here — just arithmetic from the
// same numbers already in the CSS. Update these three if that CSS changes.
const OPTION_ITEM_HEIGHT = 2.2; // .option-item: padding-top(0.5) + padding-bottom(0.5) + line-height (font-size 1.2 × uikit's default 1.0 line-height multiplier)
const OPTION_ITEM_GAP    = 0.3; // .option-menu-inner's gap-row
const OPTION_MENU_HEIGHT = 8;   // .option-menu's fixed height

function truncate(s: string, max: number): string {
    // Three ASCII periods, not '…' (U+2026) — same missing-glyph risk flagged
    // throughout UikitLessonsLearned.md — uikit's pre-built Inter MSDF atlas
    // doesn't cover every typographic character, only a known-tested subset,
    // so special characters are guilty until proven innocent rather than
    // assumed safe.
    return s.length > max ? s.slice(0, max - 3) + '...' : s;
}

function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

export class XRActiveScene {
    // Resolved once (the panel entity/document are created once and persist —
    // see playPanelEntity in index.ts), then reused across every show().
    private _doc: UIKitDocument | null = null;

    // Cached per-frame-update element refs, re-resolved each show() (the
    // underlying songPlayer/totalDuration change per song, so this can't be
    // resolved once at construction time).
    private _playIcon:  ReturnType<UIKitDocument['getElementById']> = null;
    private _pauseIcon: ReturnType<UIKitDocument['getElementById']> = null;
    private _seekFill:  ReturnType<UIKitDocument['getElementById']> = null;
    private _seekThumb: ReturnType<UIKitDocument['getElementById']> = null;
    private _timeEl:    ReturnType<UIKitDocument['getElementById']> = null;

    private _sectionTicks: InstanceType<typeof UIKit.Container>[] = [];

    // Non-null only while actively dragging the seek bar — the fraction (0-1)
    // the drag handlers want fill/thumb/time to show right now, previewed
    // without touching songPlayer until pointer-up commits it. While this is
    // set, _perFrameUpdate defers to it instead of the real (frozen, since
    // scrubbing pauses playback) songPlayer.currentSecond, so the two don't
    // fight over the same elements every frame.
    private _scrubFraction: number | null = null;

    // Open/closed state for the Speed dropdown popover (see as-speed-menu in
    // ui/play.uikitml) — same idiom as XRSongLibrary.ts's sortOpen.
    private _speedMenuOpen = false;
    // Previous-frame's _speedMenuOpen, so _wireSpeedDropdown can tell "just
    // opened this render" apart from "already open, some unrelated control
    // triggered a rerender" — only the former should recenter the scroll on
    // the selected preset; the latter would fight the user's own scrolling.
    private _speedMenuWasOpen = false;

    // Custom-scroll offset per option-menu popover (keyed by the menu's own
    // element id, so this generalizes to Difficulty's menu later without
    // needing a second field) — see _wireOptionMenuScroll. Persisted here
    // rather than as a local in that method so an unrelated rerender (e.g.
    // clicking Playpause while the dropdown happens to be open) doesn't
    // visibly snap the scroll position back to the top.
    private _optionMenuScrollOffsets = new Map<string, number>();

    show(
        panelEntity: Entity,
        songTitle: string,
        songArtist: string,
        artUrl: string | null,
        songPlayer: SongPlayer,
        totalDuration: number,
        sections: SongSection[],
        // Starts recalibration; calls done() when the user presses Done in fine-tune.
        startCalibration: (done: () => void) => void,
        // Pause + 3s rollback + 3-2-1 countdown, then resume.
        onResumeWithCountdown: (pausedAt: number) => void,
        onSettings: () => void,
        // Register a callback HighwaySystem calls every frame before each render.
        registerPanelUpdate: (cb: () => void) => void,
        onBack: () => void,
    ): void {
        const proceed = (doc: UIKitDocument) => {
            this._doc = doc;
            this._render(
                doc, songTitle, songArtist, artUrl, songPlayer, totalDuration, sections,
                startCalibration, onResumeWithCountdown, onSettings, registerPanelUpdate, onBack,
            );
        };

        if (this._doc) { proceed(this._doc); return; }

        const poll = () => {
            const doc = panelEntity.getValue(PanelDocument, 'document') as UIKitDocument | null;
            if (doc) { proceed(doc); return; }
            setTimeout(poll, 100);
        };
        poll();
    }

    private _render(
        doc: UIKitDocument,
        songTitle: string,
        songArtist: string,
        artUrl: string | null,
        songPlayer: SongPlayer,
        totalDuration: number,
        sections: SongSection[],
        startCalibration: (done: () => void) => void,
        onResumeWithCountdown: (pausedAt: number) => void,
        onSettings: () => void,
        registerPanelUpdate: (cb: () => void) => void,
        onBack: () => void,
    ): void {
        const rerender = () => this._render(
            doc, songTitle, songArtist, artUrl, songPlayer, totalDuration, sections,
            startCalibration, onResumeWithCountdown, onSettings, registerPanelUpdate, onBack,
        );

        doc.getElementById('as-song-title')?.setProperties({ text: truncate(songTitle, MAX_TITLE_CHARS) });
        doc.getElementById('as-song-subtitle')?.setProperties({ text: truncate(songArtist, MAX_SUBTITLE_CHARS) });
        doc.getElementById('as-time-total')?.setProperties({ text: formatTime(totalDuration) });

        const artEl = doc.getElementById('as-art-img');
        if (artUrl) artEl?.setProperties({ display: 'flex', src: artUrl });
        else        artEl?.setProperties({ display: 'none' });

        // Both gated fully off for now — see the STATS_ROW_ENABLED/
        // DIFFICULTY_ENABLED comment near the top of this file. Setting
        // display explicitly (rather than relying on the compiled-in
        // default) means flipping either const later needs no markup change.
        doc.getElementById('as-stats-row')?.setProperties({ display: STATS_ROW_ENABLED ? 'flex' : 'none' });
        doc.getElementById('as-difficulty-dropdown')?.setProperties({ display: DIFFICULTY_ENABLED ? 'flex' : 'none' });

        this._buildSectionTicks(doc, sections, totalDuration);
        this._wireSpeedDropdown(doc, songPlayer, rerender);

        this._setClick(doc, 'as-library', onBack);
        this._setClick(doc, 'as-settings', () => {
            if (songPlayer.isPlaying) songPlayer.pause();
            onSettings();
        });
        this._setClick(doc, 'as-reposition', () => {
            if (songPlayer.isPlaying) songPlayer.pause();
            startCalibration(() => rerender());
        });
        this._setClick(doc, 'as-playpause', () => {
            if (songPlayer.isPlaying) {
                songPlayer.pause();
                rerender();
            } else {
                onResumeWithCountdown(songPlayer.currentSecond);
            }
        });

        this._wireSeekDrag(doc, songPlayer, totalDuration, onResumeWithCountdown, rerender);

        // Cache per-frame-update refs and register the update loop. Re-registering
        // on every _render() is fine — registerPanelUpdate just replaces whatever
        // callback was previously stored (see world.globals.updateActivePanel in
        // src/xr/index.ts), it doesn't accumulate listeners.
        this._playIcon  = doc.getElementById('as-play-icon');
        this._pauseIcon = doc.getElementById('as-pause-icon');
        this._seekFill  = doc.getElementById('as-seek-fill');
        this._seekThumb = doc.getElementById('as-seek-thumb');
        this._timeEl    = doc.getElementById('as-time');
        this._setPlayPauseIcon(songPlayer.isPlaying);

        registerPanelUpdate(() => this._perFrameUpdate(songPlayer, totalDuration));
    }

    private _perFrameUpdate(songPlayer: SongPlayer, totalDuration: number): void {
        if (songPlayer.isPlaying && totalDuration > 0 && songPlayer.currentSecond >= totalDuration) {
            songPlayer.pause();
            songPlayer.seekTo(totalDuration);
        }

        this._setPlayPauseIcon(songPlayer.isPlaying);

        // While scrubbing, _wireSeekDrag's handlers own fill/thumb/time.
        if (this._scrubFraction != null) return;

        const t        = Math.min(songPlayer.currentSecond, totalDuration > 0 ? totalDuration : Infinity);
        const fraction = totalDuration > 0 ? Math.min(t / totalDuration, 1) : 0;
        this._applyProgress(fraction, totalDuration);
    }

    // Shared by normal playback (_perFrameUpdate) and drag preview (_wireSeekDrag)
    // so both draw the seek bar the same way from a single 0-1 fraction.
    private _applyProgress(fraction: number, totalDuration: number): void {
        const pct = Math.max(0, Math.min(fraction, 1)) * 100;
        this._seekFill?.setProperties({ width: `${pct}%` });
        this._seekThumb?.setProperties({ positionLeft: `${pct}%` });
        this._timeEl?.setProperties({ text: formatTime(fraction * totalDuration) });
    }

    private _setPlayPauseIcon(isPlaying: boolean): void {
        this._playIcon?.setProperties({ display: isPlaying ? 'none' : 'flex' });
        this._pauseIcon?.setProperties({ display: isPlaying ? 'flex' : 'none' });
    }

    private _buildSectionTicks(doc: UIKitDocument, sections: SongSection[], totalDuration: number): void {
        const track = doc.getElementById('as-seek-track');
        if (!track) return;

        for (const tick of this._sectionTicks) track.remove(tick);
        this._sectionTicks = [];

        if (totalDuration <= 0) return;

        for (const s of sections) {
            if (s.StartTime == null || s.StartTime <= 0) continue;
            const pct = Math.min((s.StartTime / totalDuration) * 100, 100);
            // Hacky but simple: skip ticks landing within the track's rounded-
            // end regions — a straight-edged tick there pokes out past the
            // curve since nothing clips to .seek-track's border-radius (an
            // overflow:hidden clip wrapper was tried and reverted; this direct
            // percentage-based skip is the fallback). ~2.3% is roughly
            // border-radius(0.7) / the track's actual rendered width at this
            // layout's proportions — approximate, not computed from the real
            // measured width, so nudge this if it looks off in headset.
            const EDGE_SKIP_PCT = 3;
            if (pct < EDGE_SKIP_PCT || pct > 100 - EDGE_SKIP_PCT) continue;
            const tick = new UIKit.Container({ positionLeft: `${pct}%` }, ['section-tick']);
            track.add(tick);
            this._sectionTicks.push(tick);
        }
    }

    // Speed dropdown popover — same trigger/menu/chevron-swap idiom as
    // XRSongLibrary.ts's sort dropdown (see as-speed-* in ui/play.uikitml).
    private _wireSpeedDropdown(doc: UIKitDocument, songPlayer: SongPlayer, rerender: () => void): void {
        doc.getElementById('as-speed-trigger-label')?.setProperties({ text: speedPercentLabel(songPlayer.playbackRate) });
        doc.getElementById('as-speed-menu')?.setProperties({ display: this._speedMenuOpen ? 'flex' : 'none' });
        doc.getElementById('as-speed-chevron-down')?.setProperties({ display: this._speedMenuOpen ? 'none' : 'flex' });
        doc.getElementById('as-speed-chevron-up')?.setProperties({ display: this._speedMenuOpen ? 'flex' : 'none' });
        doc.getElementById('as-speed-trigger')?.setProperties({
            onClick: () => {
                this._speedMenuOpen = !this._speedMenuOpen;
                rerender();
            },
        });

        let selectedIndex = -1;
        SPEED_PRESETS.forEach((preset, i) => {
            const id = `as-speed-opt-${Math.round(preset * 100)}`;
            const el = doc.getElementById(id);
            if (!el) return;
            const selected = Math.abs(preset - songPlayer.playbackRate) < 0.001;
            if (selected) selectedIndex = i;
            this._setOptionSelected(el, selected);
            el.setProperties({
                onClick: () => {
                    songPlayer.playbackRate = preset;
                    this._speedMenuOpen = false;
                    rerender();
                },
            });
        });

        // Only recenter on the freshly-opened transition — not on every
        // rerender an already-open menu happens to receive from an
        // unrelated control (e.g. Playpause), which would otherwise fight
        // the user's own in-progress scrolling.
        const justOpened = this._speedMenuOpen && !this._speedMenuWasOpen;
        this._speedMenuWasOpen = this._speedMenuOpen;

        let initialOffset: number | undefined;
        if (justOpened && selectedIndex >= 0) {
            const distanceFromTop = selectedIndex * (OPTION_ITEM_HEIGHT + OPTION_ITEM_GAP) + OPTION_ITEM_HEIGHT / 2;
            const contentHeight = SPEED_PRESETS.length * OPTION_ITEM_HEIGHT + (SPEED_PRESETS.length - 1) * OPTION_ITEM_GAP;
            const maxOffsetEstimate = Math.max(0, contentHeight - OPTION_MENU_HEIGHT);
            initialOffset = Math.max(0, Math.min(distanceFromTop - OPTION_MENU_HEIGHT / 2, maxOffsetEstimate));
        }
        this._wireOptionMenuScroll(doc, 'as-speed-menu', 'as-speed-menu-inner', initialOffset);
    }

    // Custom drag-to-scroll for an option-menu popover, replacing @pmndrs/
    // uikit's built-in overflow:scroll — confirmed in-headset that its
    // pointer capture (set on whichever object was actually hit) and
    // release (attempted on the container specifically) mismatch whenever a
    // drag starts on a child button rather than empty container space,
    // wedging capture and permanently breaking scroll. At this popover's
    // small size, buttons cover nearly the whole surface, so that's nearly
    // every gesture — see UikitLessonsLearned.md.
    //
    // Deliberately does NOT call setPointerCapture on every pointerdown the
    // way _wireSeekDrag does — @pmndrs/pointer-events' own click synthesis
    // (node_modules/@pmndrs/pointer-events/dist/pointer.js's up()/
    // getIsClicked()) only fires 'click' when the object released on has the
    // exact same recorded down-timestamp as the object originally pressed —
    // capturing eagerly would immediately break that match (the captured
    // object becomes whatever's under the pointer at up-time) and silently
    // kill every option's onClick, tap or not. Instead, capture is deferred
    // until real drag distance is confirmed: a genuine tap's down and up
    // both land on the same button untouched, so getIsClicked's identity
    // check still passes and the existing onClick handlers above keep
    // working unmodified. Once a real drag is confirmed, capturing on the
    // menu itself (not whatever button was under the initial press) also
    // means move/up keep arriving even if the ray/hand drifts outside this
    // small popover's bounds mid-drag.
    // initialOffset: a pre-clamped scroll offset to open the menu at (e.g.
    // centering the current selection) — only meaningful on the render that
    // just opened the menu (see the justOpened check in _wireSpeedDropdown);
    // pass undefined on every other rerender so an already-open menu keeps
    // whatever offset the user has scrolled it to. Deliberately a plain
    // number the caller computes, not an element id this method would have
    // to measure itself — see the comment below on why.
    private _wireOptionMenuScroll(doc: UIKitDocument, menuId: string, innerId: string, initialOffset?: number): void {
        const menu = doc.getElementById(menuId);
        const inner = doc.getElementById(innerId);
        if (!menu || !inner) return;

        // Local-space movement (same normalized -0.5..0.5 units as
        // WorldPointerEvent's pointerFraction, see the comment above it)
        // past which a press is promoted from "maybe a tap" to a real drag.
        const DRAG_THRESHOLD = 0.03;

        // pressed: true from onPointerDown until onPointerUp/onPointerCancel
        // — this is the actual "is a pinch/click currently held" gate.
        // dragging: only meaningful while pressed; true once movement has
        // crossed DRAG_THRESHOLD during the current press. Conflating these
        // into one flag was the bug in the first pass — onPointerMove fires
        // on every hover, not just while pressed (same behavior already hit
        // once with the diagnostic logging spam), so without a dedicated
        // pressed gate, mere hovering computed a delta against a stale
        // startLocalY and immediately "dragged". _wireSeekDrag already
        // guards this correctly (`if (!scrubbing) return;`) — mirroring
        // that here.
        let pressed = false;
        let dragging = false;
        let startLocalY = 0;
        let startOffset = this._optionMenuScrollOffsets.get(menuId) ?? 0;

        const maxOffset = (): number => {
            const innerSize = inner.size.peek();
            const menuSize = menu.size.peek();
            if (!innerSize || !menuSize) return 0;
            return Math.max(0, innerSize[1] - menuSize[1]);
        };

        const applyOffset = (o: number): void => {
            const clamped = Math.max(0, Math.min(o, maxOffset()));
            this._optionMenuScrollOffsets.set(menuId, clamped);
            // position-top negative = shifted up, same convention as the
            // seek-thumb's fixed position-top:-0.3 — growing more negative
            // as offset grows reveals lower content.
            inner.setProperties({ positionTop: -clamped });
        };

        if (initialOffset != null) {
            // Deliberately bypasses applyOffset's own maxOffset()-based
            // clamp — confirmed in-headset that inner.size/menu.size read
            // [0,0] at this exact synchronous point (Yoga hasn't laid out
            // the newly-visible subtree yet, see the comment above
            // OPTION_ITEM_HEIGHT), which would clamp any nonzero target
            // straight back down to 0 here specifically, the same way it
            // silently broke three earlier attempts at this (live retries
            // included — the retries themselves ran fine, they just kept
            // reading the same [0,0]). The caller already computed and
            // clamped this analytically from known constants, so it's
            // trustworthy without a live measurement.
            this._optionMenuScrollOffsets.set(menuId, initialOffset);
            inner.setProperties({ positionTop: -initialOffset });
        } else {
            // Re-apply on every (re)wire — content height can in principle
            // change (a future filtered/variable-length menu), even though
            // Speed's own 10 presets never do. This path (unlike the one
            // above) is fine to run through the live-measured clamp — by
            // the time an already-open menu rerenders for an unrelated
            // reason, layout has long since settled.
            applyOffset(startOffset);
        }

        // Disables every other interactive element in the panel while a
        // real drag is in progress — confirmed in-headset that the ray
        // cursor could otherwise still hover/click things behind or beside
        // this popover mid-drag. pointerEvents is an inherited property
        // (node_modules/@pmndrs/uikit/dist/properties/inheritance.js), so
        // flipping it at the panel root cascades to everything — except
        // .option-menu itself, which has its own explicit override in
        // play.uikitml specifically so this doesn't also lock itself out.
        // Only toggled once a real drag is confirmed, not from plain
        // pressed — doing this eagerly on every pointerdown would risk
        // interfering with a genuine tap's click (pointerEvents is
        // re-checked live on each raycast, not just once at press time, so
        // changing it mid-gesture before a tap's matching pointerup could
        // in principle change what object that up event resolves to).
        const setOtherInteractorsEnabled = (enabled: boolean): void => {
            doc.rootElement.setProperties({ pointerEvents: enabled ? 'auto' : 'none' });
        };

        menu.setProperties({
            onPointerDown: (e: WorldPointerEvent) => {
                if (!e.point) return;
                const local = menu.worldToLocal(e.point.clone());
                pressed = true;
                dragging = false;
                startLocalY = local.y;
                startOffset = this._optionMenuScrollOffsets.get(menuId) ?? 0;
            },
            onPointerMove: (e: WorldPointerEvent) => {
                if (!pressed || !e.point) return;
                const local = menu.worldToLocal(e.point.clone());
                const deltaNorm = local.y - startLocalY;
                if (!dragging) {
                    if (Math.abs(deltaNorm) < DRAG_THRESHOLD) return;
                    dragging = true;
                    e.currentTarget?.setPointerCapture?.(e.pointerId);
                    setOtherInteractorsEnabled(false);
                }
                const menuSize = menu.size.peek();
                const deltaUnits = deltaNorm * (menuSize?.[1] ?? 0);
                const target = startOffset + deltaUnits;
                applyOffset(target);
            },
            onPointerUp: (e: WorldPointerEvent) => {
                if (dragging) {
                    e.currentTarget?.releasePointerCapture?.(e.pointerId);
                    setOtherInteractorsEnabled(true);
                }
                pressed = false;
                dragging = false;
            },
            onPointerCancel: (e: WorldPointerEvent) => {
                if (dragging) {
                    e.currentTarget?.releasePointerCapture?.(e.pointerId);
                    setOtherInteractorsEnabled(true);
                }
                pressed = false;
                dragging = false;
            },
        });
    }

    private _setOptionSelected(el: ReturnType<UIKitDocument['getElementById']>, selected: boolean): void {
        if (!el) return;
        if (selected) { if (!el.classList.contains('option-item-selected')) el.classList.add('option-item-selected'); }
        else          { if (el.classList.contains('option-item-selected')) el.classList.remove('option-item-selected'); }
    }

    private _wireSeekDrag(
        doc: UIKitDocument,
        songPlayer: SongPlayer,
        totalDuration: number,
        onResumeWithCountdown: (pausedAt: number) => void,
        rerender: () => void,
    ): void {
        const track = doc.getElementById('as-seek-track');
        if (!track) return;

        let scrubbing = false;
        let scrubWasPlaying = false;
        // How far off the thumb's own center you actually grabbed, so the
        // thumb keeps that same relative offset from the interactor while
        // dragging instead of snapping its center to the exact grab point.
        let scrubOffset = 0;
        let pointerDownTime = 0;

        // A quick pinch (down immediately followed by up, no real hold/drag
        // in between) reads as a tap-to-seek — jump straight to wherever was
        // raycasted, ignoring the grab-offset math below (which only makes
        // sense once something's actually been dragged).
        const QUICK_TAP_MS = 200;

        // See the comment above WorldPointerEvent for why this goes through
        // track.worldToLocal(event.point) rather than event.localPoint, and
        // why "+ 0.5" — this is the established uikit drag-math pattern
        // (mirroring scroll.js), not a guess.
        const pointerFraction = (e: WorldPointerEvent): number | null => {
            if (!e.point) return null;
            const local = track.worldToLocal(e.point.clone());
            return Math.max(0, Math.min(local.x + 0.5, 1));
        };

        track.setProperties({
            onPointerDown: (e: WorldPointerEvent) => {
                const pf = pointerFraction(e);
                if (pf == null) return;

                scrubbing = true;
                pointerDownTime = performance.now();
                scrubWasPlaying = songPlayer.isPlaying;
                if (scrubWasPlaying) songPlayer.pause();
                // Capture so move/up keep firing even once the interactor
                // drags outside the track's own bounds — without this, drag
                // input only arrives while directly hovering the track.
                e.currentTarget?.setPointerCapture?.(e.pointerId);

                const thumbFraction = totalDuration > 0 ? songPlayer.currentSecond / totalDuration : 0;
                scrubOffset = pf - thumbFraction;
                this._scrubFraction = thumbFraction;
                this._applyProgress(thumbFraction, totalDuration);
            },
            onPointerMove: (e: WorldPointerEvent) => {
                if (!scrubbing) return;
                const pf = pointerFraction(e);
                if (pf == null) return;
                const target = Math.max(0, Math.min(pf - scrubOffset, 1));
                this._scrubFraction = target;
                this._applyProgress(target, totalDuration);
                // Actually move the (paused) playhead too, not just the visual
                // preview — lets the user scrub through the song/highway to
                // find the right spot before releasing, same as a normal
                // media scrubber. Final commit on pointer-up still happens
                // (rather than relying on this), since a quick tap has no
                // move events to have done it here.
                songPlayer.seekTo(target * totalDuration);
            },
            onPointerUp: (e: WorldPointerEvent) => {
                if (!scrubbing) return;
                scrubbing = false;
                e.currentTarget?.releasePointerCapture?.(e.pointerId);

                const isQuickTap = performance.now() - pointerDownTime < QUICK_TAP_MS;
                const target = isQuickTap
                    ? pointerFraction(e) ?? this._scrubFraction ?? 0
                    : this._scrubFraction ?? 0;
                this._scrubFraction = null;
                songPlayer.seekTo(target * totalDuration);

                if (scrubWasPlaying) {
                    onResumeWithCountdown(songPlayer.currentSecond);
                } else {
                    rerender();
                }
            },
        });
    }

    private _setClick(doc: UIKitDocument, id: string, onClick: () => void): void {
        doc.getElementById(id)?.setProperties({ onClick });
    }
}

function speedPercentLabel(r: number): string {
    return `Speed: ${Math.round(r * 100)}%`;
}
