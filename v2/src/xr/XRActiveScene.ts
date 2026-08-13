import type { Entity, UIKitDocument } from "@iwsdk/core";
import { PanelDocument, UIKit } from "@iwsdk/core";
import type { SongPlayer } from "../shared/SongPlayer";
import type { SongSection } from "../shared/SongFormat";
import type { DynamicOption, OptionDropdownItem, OptionMenuLayout, WorldPointerEvent } from "./OptionDropdown";
import { OptionDropdown, difficultyOptionLabel, difficultyPercentLabel } from "./OptionDropdown";

// uikit-based (see ui/play.uikitml), migrated off html2canvas — same pattern as
// XRSettingsScene.ts/XRPreScene.ts, but also has per-frame content (play/pause,
// seek, elapsed time) wired through registerPanelUpdate, not just click-driven rerenders.

const MAX_TITLE_CHARS    = 26;
const MAX_SUBTITLE_CHARS = 30;

// Note-hit streaks have no backing data model yet (see Stretch Goal B) — the row is already
// built in ui/play.uikitml, just gated off until the real feature lands. Difficulty is real
// now (see ThreeCP/Analysis/DifficultyDropdownPlan.md) — its own visibility is per-song,
// driven by whether the loaded part actually has AvailableDifficulties.
const STATS_ROW_ENABLED = false;

// Matches desktop's SPEED_PRESET_STEP: 20% steps, 20%-200%. No separate fine
// +/-0.05 stepper here — the XR design only shows a single dropdown trigger.
const SPEED_PRESETS = [0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0];

// Mirrors .option-item/.option-menu-inner/.option-menu in ui/play.uikitml — see
// OptionDropdown.ts's computeCenteredOffset(). Update if that CSS changes.
const OPTION_MENU_LAYOUT: OptionMenuLayout = {
    itemHeight: 2.2, // .option-item: padding-top(0.5) + padding-bottom(0.5) + line-height(1.2)
    itemGap:    0.3, // .option-menu-inner's gap-row
    menuHeight: 8,   // .option-menu's fixed height
};

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

    // Non-null only while dragging the seek bar: the previewed 0-1 fraction, applied
    // instead of songPlayer.currentSecond until pointer-up commits it.
    private _scrubFraction: number | null = null;

    private _speedDropdown = new OptionDropdown({
        trigger: 'as-speed-trigger',
        triggerLabelSlot: 'as-speed-trigger-label-slot',
        chevronDown: 'as-speed-chevron-down',
        chevronUp: 'as-speed-chevron-up',
        menu: 'as-speed-menu',
        menuInner: 'as-speed-menu-inner',
    });

    private _difficultyDropdown = new OptionDropdown({
        trigger: 'as-difficulty-trigger',
        triggerLabelSlot: 'as-difficulty-trigger-label-slot',
        chevronDown: 'as-difficulty-chevron-down',
        chevronUp: 'as-difficulty-chevron-up',
        menu: 'as-difficulty-menu',
        menuInner: 'as-difficulty-menu-inner',
    });

    // Difficulty has no real playback effect yet (phase 5 — see DifficultyDropdownPlan.md), so
    // unlike Speed (whose selection genuinely is songPlayer.playbackRate) there's no existing
    // state to read the current selection from — this field exists purely to drive the trigger
    // label/highlighted option. Reset to null in show() (new song), not on every rerender.
    private _selectedDifficulty: number | null = null;

    show(
        panelEntity: Entity,
        songTitle: string,
        songArtist: string,
        artUrl: string | null,
        songPlayer: SongPlayer,
        totalDuration: number,
        sections: SongSection[],
        availableDifficulties: number[],
        // Starts recalibration; calls done() when the user presses Done in fine-tune.
        startCalibration: (done: () => void) => void,
        // Pause + 3s rollback + 3-2-1 countdown, then resume.
        onResumeWithCountdown: (pausedAt: number) => void,
        onSettings: () => void,
        // Register a callback HighwaySystem calls every frame before each render.
        registerPanelUpdate: (cb: () => void) => void,
        onBack: () => void,
    ): void {
        // New song — Difficulty's selection (unlike Speed's, which reads straight from
        // songPlayer.playbackRate) is local UI state and would otherwise carry over from
        // whatever song was playing before.
        this._selectedDifficulty = null;

        const proceed = (doc: UIKitDocument) => {
            this._doc = doc;
            this._render(
                doc, songTitle, songArtist, artUrl, songPlayer, totalDuration, sections, availableDifficulties,
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
        availableDifficulties: number[],
        startCalibration: (done: () => void) => void,
        onResumeWithCountdown: (pausedAt: number) => void,
        onSettings: () => void,
        registerPanelUpdate: (cb: () => void) => void,
        onBack: () => void,
    ): void {
        const rerender = () => this._render(
            doc, songTitle, songArtist, artUrl, songPlayer, totalDuration, sections, availableDifficulties,
            startCalibration, onResumeWithCountdown, onSettings, registerPanelUpdate, onBack,
        );

        doc.getElementById('as-song-title')?.setProperties({ text: truncate(songTitle, MAX_TITLE_CHARS) });
        doc.getElementById('as-song-subtitle')?.setProperties({ text: truncate(songArtist, MAX_SUBTITLE_CHARS) });
        doc.getElementById('as-time-total')?.setProperties({ text: formatTime(totalDuration) });

        const artEl = doc.getElementById('as-art-img');
        if (artUrl) artEl?.setProperties({ display: 'flex', src: artUrl });
        else        artEl?.setProperties({ display: 'none' });

        // Stats row is gated fully off for now — see STATS_ROW_ENABLED near the top of this
        // file. Setting display explicitly (rather than relying on the compiled-in default)
        // means flipping it later needs no markup change.
        doc.getElementById('as-stats-row')?.setProperties({ display: STATS_ROW_ENABLED ? 'flex' : 'none' });
        doc.getElementById('as-difficulty-dropdown')?.setProperties({
            display: availableDifficulties.length > 0 ? 'flex' : 'none',
        });

        this._buildSectionTicks(doc, sections, totalDuration);
        this._wireSpeedDropdown(doc, songPlayer, rerender);
        if (availableDifficulties.length > 0) this._wireDifficultyDropdown(doc, availableDifficulties, rerender);

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
        this._speedDropdown.setTriggerLabel(doc, speedPercentLabel(songPlayer.playbackRate), 'option-label');

        const items: OptionDropdownItem[] = SPEED_PRESETS.map(preset => ({
            id: `as-speed-opt-${Math.round(preset * 100)}`,
            selected: Math.abs(preset - songPlayer.playbackRate) < 0.001,
            onSelect: () => { songPlayer.playbackRate = preset; },
        }));

        this._speedDropdown.render(doc, items, OPTION_MENU_LAYOUT, rerender);
    }

    // Difficulty dropdown popover — same shape as Speed's, but the option count/labels vary per
    // song (renderDynamic(), not render()) and the "selected" value is local UI state rather than
    // read from a real property (see _selectedDifficulty). Only called when availableDifficulties
    // is non-empty (see _render()). No playback effect yet — see DifficultyDropdownPlan.md phase 5.
    private _wireDifficultyDropdown(doc: UIKitDocument, availableDifficulties: number[], rerender: () => void): void {
        const sorted = [...availableDifficulties].sort((a, b) => a - b);
        const max = sorted[sorted.length - 1];
        const count = sorted.length;

        // Lazy default on first render for this song — max value (100%, no reduction), same
        // "safe default" role Speed's 100% plays. show() resets this to null per new song.
        if (this._selectedDifficulty == null) this._selectedDifficulty = max;

        // Percentage is by rank (1-based position in the sorted list), not raw value/max — the
        // raw values are an arbitrary per-song scale that can start at 0, which would otherwise
        // show the easiest option as a misleading "0%". Rank guarantees the range is (0%, 100%].
        const rankOf = (value: number): number => sorted.indexOf(value) + 1;

        this._difficultyDropdown.setTriggerLabel(
            doc, difficultyPercentLabel(rankOf(this._selectedDifficulty), count), 'option-label',
        );

        const options: DynamicOption[] = sorted.map((value, i) => ({
            label: difficultyOptionLabel(i + 1, count),
            selected: value === this._selectedDifficulty,
            onSelect: () => { this._selectedDifficulty = value; },
        }));

        this._difficultyDropdown.renderDynamic(doc, options, OPTION_MENU_LAYOUT, rerender);
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

        // track.worldToLocal(event.point), not event.localPoint — the latter is relative to
        // whichever sub-element was actually hit (thumb/fill/tick/track), so its reference frame
        // shifts depending on what was grabbed; see UikitLessonsLearned.md. Local space is
        // centered/normalized (x=0 is the track's center, ±0.5 its edges), hence the "+ 0.5" —
        // the established uikit drag-math pattern (mirroring scroll.js), not a guess.
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
