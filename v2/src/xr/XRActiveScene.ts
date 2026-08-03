import type { Entity, UIKitDocument } from "@iwsdk/core";
import { PanelDocument, UIKit } from "@iwsdk/core";
import type { Vector3 } from "three";
import type { SongPlayer } from "../shared/SongPlayer";
import type { SongSection } from "../shared/SongFormat";

// uikit-based (see ui/play.uikitml), migrated off html2canvas — same pattern as
// XRSettingsScene.ts/XRPreScene.ts, but also has per-frame content (play/pause,
// seek, elapsed time) wired through registerPanelUpdate, not just click-driven rerenders.

// Local slice of @pmndrs/pointer-events' PointerEvent (transitive dep only).
// setPointerCapture on pointerdown keeps onPointerMove/onPointerUp firing even once the
// ray/hand drags outside the seek track's bounds. Use event.point (world-space) +
// track.worldToLocal(), never event.localPoint — it's relative to whichever sub-element
// was actually hit (thumb/fill/tick/track), so its reference frame shifts depending on
// what was grabbed; see UikitLessonsLearned.md. Local space is centered/normalized:
// x=0 is the track's center, ±0.5 its edges, so `localPoint.x + 0.5` is the 0-1 fraction.
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

// Note-hit streaks and in-play Difficulty have no backing data model yet (see
// Stretch Goal B / SongFormat.SongDifficulty being static metadata) — both rows
// are already built in ui/play.uikitml, just gated off until the real features land.
const STATS_ROW_ENABLED = false;
const DIFFICULTY_ENABLED = false;

// Matches desktop's SPEED_PRESET_STEP: 20% steps, 20%-200%. No separate fine
// +/-0.05 stepper here — the XR design only shows a single dropdown trigger.
const SPEED_PRESETS = [0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0];

// Mirrors .option-item/.option-menu-inner/.option-menu in ui/play.uikitml, used to compute
// the dropdown's open-scroll target via arithmetic instead of live .size/.relativeCenter
// reads — those read [0,0] at the exact moment display flips to 'flex' (Yoga hasn't laid
// out the subtree yet). Update these three if that CSS changes.
const OPTION_ITEM_HEIGHT = 2.2; // .option-item: padding-top(0.5) + padding-bottom(0.5) + line-height(1.2)
const OPTION_ITEM_GAP    = 0.3; // .option-menu-inner's gap-row
const OPTION_MENU_HEIGHT = 8;   // .option-menu's fixed height

function truncate(s: string, max: number): string {
    // ASCII periods, not '…' — uikit's Inter MSDF atlas doesn't cover every glyph (UikitLessonsLearned.md).
    return s.length > max ? s.slice(0, max - 3) + '...' : s;
}

function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

export class XRActiveScene {
    // Panel entity/document are created once and persist (see playPanelEntity in index.ts).
    private _doc: UIKitDocument | null = null;

    // Re-resolved each show() since songPlayer/totalDuration change per song.
    private _playIcon:  ReturnType<UIKitDocument['getElementById']> = null;
    private _pauseIcon: ReturnType<UIKitDocument['getElementById']> = null;
    private _seekFill:  ReturnType<UIKitDocument['getElementById']> = null;
    private _seekThumb: ReturnType<UIKitDocument['getElementById']> = null;
    private _timeEl:    ReturnType<UIKitDocument['getElementById']> = null;

    private _sectionTicks: InstanceType<typeof UIKit.Container>[] = [];

    // Currently-mounted Speed trigger label node — destroyed/recreated on each value
    // change rather than mutated in place (see .option-label in ui/play.uikitml).
    private _speedTriggerLabelNode: InstanceType<typeof UIKit.Text> | null = null;

    // Non-null only while dragging the seek bar: the previewed 0-1 fraction, applied
    // instead of songPlayer.currentSecond until pointer-up commits it.
    private _scrubFraction: number | null = null;

    // Speed dropdown open/closed state (as-speed-menu), same idiom as XRSongLibrary's sortOpen.
    private _speedMenuOpen = false;
    // Previous-frame value, so _wireSpeedDropdown can recenter scroll only on the open
    // transition, not on every unrelated rerender of an already-open menu.
    private _speedMenuWasOpen = false;

    // Scroll offset per option-menu popover, keyed by menu id (generalizes to Difficulty's
    // menu later). Persisted here, not as a method local, so unrelated rerenders don't snap it to 0.
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
        this._setSpeedTriggerLabel(doc, speedPercentLabel(songPlayer.playbackRate));

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

        // Recenter only on the open transition, not every rerender (e.g. Playpause)
        // of an already-open menu, which would fight the user's own scrolling.
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

    // Destroys/recreates the trigger's label node instead of mutating .text — mutating in
    // place left stale glyphs rendering behind new text (see .option-label in ui/play.uikitml).
    private _setSpeedTriggerLabel(doc: UIKitDocument, text: string): void {
        const slot = doc.getElementById('as-speed-trigger-label-slot');
        if (!slot) return;
        if (this._speedTriggerLabelNode) slot.remove(this._speedTriggerLabelNode);
        this._speedTriggerLabelNode = new UIKit.Text({ text }, ['option-label']);
        slot.add(this._speedTriggerLabelNode);
    }

    // Custom drag-to-scroll, replacing overflow:scroll — its capture/release object
    // mismatch wedges scroll permanently once a drag starts on a child button (nearly
    // every gesture at this popover's size). See UikitLessonsLearned.md. Deliberately
    // doesn't capture on every pointerdown like _wireSeekDrag does: native click synthesis
    // requires down/up to land on the same object, so eager capture would break every
    // option's onClick. Capture is deferred until real drag distance is confirmed.
    //
    // initialOffset: pre-clamped scroll offset to open at (e.g. centered selection) — only
    // set on the render that just opened the menu; undefined otherwise so the user's own
    // scroll position is preserved. A plain number, not an id, since only the caller
    // (already computing it analytically) can supply it before layout has settled.
    private _wireOptionMenuScroll(doc: UIKitDocument, menuId: string, innerId: string, initialOffset?: number): void {
        const menu = doc.getElementById(menuId);
        const inner = doc.getElementById(innerId);
        if (!menu || !inner) return;

        // Local-space movement (normalized -0.5..0.5, same units as WorldPointerEvent
        // above) past which a press is promoted from "maybe a tap" to a real drag.
        const DRAG_THRESHOLD = 0.03;

        // pressed: is a pinch/click currently held. dragging: only meaningful while
        // pressed, true once movement crosses DRAG_THRESHOLD. Keep these separate —
        // onPointerMove fires on every hover, not just while pressed, so without the
        // pressed gate a mere hover would "drag" against a stale startLocalY (mirrors
        // _wireSeekDrag's `if (!scrubbing) return;` guard).
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
            // Bypasses applyOffset's live maxOffset() clamp — inner.size/menu.size read
            // [0,0] at this exact synchronous point (Yoga hasn't laid out the newly-visible
            // subtree yet), which would clamp any nonzero target back to 0. The caller
            // already computed and clamped this analytically, so it's trustworthy as-is.
            this._optionMenuScrollOffsets.set(menuId, initialOffset);
            inner.setProperties({ positionTop: -initialOffset });
        } else {
            // Fine to run through the live-measured clamp here — an already-open menu's
            // layout has long since settled by the time it rerenders for an unrelated reason.
            applyOffset(startOffset);
        }

        // Disables every other interactive element while a real drag is in progress (the ray
        // cursor could otherwise hover/click things behind this popover). pointerEvents is
        // inherited, so flipping it at the panel root cascades everywhere except .option-menu
        // itself (explicit override in play.uikitml). Only toggled once a drag is confirmed,
        // not on plain pressed — pointerEvents is re-checked live on each raycast, so flipping
        // it before a tap's matching pointerup could change what object the release resolves to.
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
