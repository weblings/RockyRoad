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

function truncate(s: string, max: number): string {
    // Three ASCII periods, not '…' (U+2026) — same missing-glyph risk as '×'
    // (see speedLabel below and UikitLessonsLearned.md) — uikit's pre-built
    // Inter MSDF atlas doesn't cover every typographic character, only a
    // known-tested subset, so special characters are guilty until proven
    // innocent rather than assumed safe.
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

        doc.getElementById('as-speed-val')?.setProperties({ text: speedLabel(songPlayer.playbackRate) });

        this._buildSectionTicks(doc, sections, totalDuration);

        this._setClick(doc, 'as-library', onBack);
        this._setClick(doc, 'as-settings', () => {
            if (songPlayer.isPlaying) songPlayer.pause();
            onSettings();
        });
        this._setClick(doc, 'as-reposition', () => {
            if (songPlayer.isPlaying) songPlayer.pause();
            startCalibration(() => rerender());
        });
        this._setClick(doc, 'as-speed-dec', () => {
            songPlayer.playbackRate = Math.max(0.1, Math.round((songPlayer.playbackRate - 0.1) * 10) / 10);
            rerender();
        });
        this._setClick(doc, 'as-speed-inc', () => {
            songPlayer.playbackRate = Math.min(2.0, Math.round((songPlayer.playbackRate + 0.1) * 10) / 10);
            rerender();
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

function speedLabel(r: number): string {
    // Plain ASCII 'x', not '×' (U+00D7) — the multiplication sign isn't in
    // uikit's pre-built Inter MSDF glyph subset and renders as a missing-
    // glyph tofu box (same fix already applied to XRSettingsScene.ts's
    // highwaySizeLabel for the guitar highway-scale stepper).
    return (Math.round(r * 100) / 100).toString().replace(/\.?0+$/, '') + 'x';
}
