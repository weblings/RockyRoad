import type { Entity, UIKitDocument } from "@iwsdk/core";
import { PanelDocument } from "@iwsdk/core";
import type { SourcedEntry } from "../shared/SongSource";
import type { SongIndexPart } from "../shared/SongIndex";
import { PART_LABEL, resolveDefaultPart } from "../shared/InstrumentSelect";
import { loadSettings, saveSettings } from "../shared/Settings";
import type { DynamicOption, OptionMenuLayout } from "./OptionDropdown";
import { OptionDropdown, difficultyOptionLabel, difficultyPercentLabel, nearestRankForPercentage } from "./OptionDropdown";

// ── XRPreScene ────────────────────────────────────────────────────────────────
// uikit-based (see ui/song.uikitml) — migrated off html2canvas following the
// same pattern as XRSettingsScene.ts. Now stateful (Instrument/Difficulty
// selection persist across rerenders) — see DifficultyDropdownPlan.md's
// "Phase 3 detail" for the design.

// Mirrors .option-item/.option-menu-inner/.option-menu in ui/song.uikitml — same values as
// XRActiveScene.ts's OPTION_MENU_LAYOUT (identical CSS, hand-duplicated per-screen).
const OPTION_MENU_LAYOUT: OptionMenuLayout = {
    itemHeight: 2.2,
    itemGap:    0.3,
    menuHeight: 8,
};

// Song's .song-meta is narrower than Play's (28cm card vs. a wider full-panel row) — smaller
// caps than XRActiveScene.ts's MAX_TITLE_CHARS/MAX_SUBTITLE_CHARS (26/30).
const MAX_TITLE_CHARS    = 20;
const MAX_SUBTITLE_CHARS = 24;

function truncate(s: string, max: number): string {
    // ASCII periods, not '…' — uikit's Inter MSDF atlas doesn't cover every glyph (UikitLessonsLearned.md).
    return s.length > max ? s.slice(0, max - 3) + '...' : s;
}

export class XRPreScene {
    // Resolved once (the panel entity/document are created once and persist —
    // see preScenePanelEntity in index.ts), then reused across every show().
    private _doc: UIKitDocument | null = null;

    private _instrumentDropdown = new OptionDropdown({
        trigger: 'ps-instrument-trigger',
        triggerLabelSlot: 'ps-instrument-trigger-label-slot',
        chevronDown: 'ps-instrument-chevron-down',
        chevronUp: 'ps-instrument-chevron-up',
        menu: 'ps-instrument-menu',
        menuInner: 'ps-instrument-menu-inner',
    });

    private _difficultyDropdown = new OptionDropdown({
        trigger: 'ps-difficulty-trigger',
        triggerLabelSlot: 'ps-difficulty-trigger-label-slot',
        chevronDown: 'ps-difficulty-chevron-down',
        chevronUp: 'ps-difficulty-chevron-up',
        menu: 'ps-difficulty-menu',
        menuInner: 'ps-difficulty-menu-inner',
    });

    // Live selection, replacing the old fresh-every-render best-guess. Reset per new song in
    // show(), not on every rerender (same convention as XRActiveScene's _selectedDifficulty).
    private _selectedPart: SongIndexPart | null = null;
    private _selectedDifficulty: number | null = null;

    show(
        panelEntity: Entity,
        sourced: SourcedEntry,
        // Returns true if a saved calibration was found and applied.
        tryLoadCalibration: (instrumentType: string) => boolean,
        // Saved calibration exists — load song and go straight to active scene.
        onPlay: (sourced: SourcedEntry, partName: string) => void,
        // No saved calibration — load song first (highway visible), then full 3-step calibrate.
        onCalibratePlay: (sourced: SourcedEntry, partName: string) => void,
        // Saved calibration exists — load song then open fine-tune panel directly.
        onReposition: (sourced: SourcedEntry, partName: string) => void,
        onBack: () => void,
    ): void {
        this._selectedPart = null;
        this._selectedDifficulty = null;

        const proceed = (doc: UIKitDocument) => {
            this._doc = doc;
            this._render(doc, sourced, tryLoadCalibration, onPlay, onCalibratePlay, onReposition, onBack);
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
        sourced: SourcedEntry,
        tryLoadCalibration: (instrumentType: string) => boolean,
        onPlay: (sourced: SourcedEntry, partName: string) => void,
        onCalibratePlay: (sourced: SourcedEntry, partName: string) => void,
        onReposition: (sourced: SourcedEntry, partName: string) => void,
        onBack: () => void,
    ): void {
        const rerender = () => this._render(doc, sourced, tryLoadCalibration, onPlay, onCalibratePlay, onReposition, onBack);

        const { entry } = sourced;

        this._setClick(doc, 'ps-back', onBack);

        doc.getElementById('ps-song-title')?.setProperties({ text: truncate(entry.songName, MAX_TITLE_CHARS) });
        doc.getElementById('ps-artist-name')?.setProperties({ text: truncate(entry.artistName, MAX_SUBTITLE_CHARS) });

        const artUrl = sourced.source.getAlbumArtUrl(entry);
        const artEl = doc.getElementById('ps-art-img');
        if (artUrl) artEl?.setProperties({ display: 'flex', src: artUrl });
        else        artEl?.setProperties({ display: 'none' });

        // Vocals excluded before considering a default — matches desktop's PreSceneScreen.ts
        // (previously a latent XR gap; see DifficultyDropdownPlan.md's "Desktop comparison").
        const playableParts = entry.parts.filter(p => p.type !== 'Vocals');
        const hasPart = playableParts.length > 0;

        // Lazy default on first render for this song — resolveDefaultPart's shared chain
        // (last-used type -> Keys -> Lead -> first playable). show() resets this per new song.
        if (!this._selectedPart) {
            this._selectedPart = resolveDefaultPart(entry, loadSettings().lastInstrumentType) ?? null;
        }
        const selectedPart = this._selectedPart;

        // Re-derives every render, not just once per mount — switching Instrument changes
        // calibration type entirely (Keys vs. Guitar family).
        const hasSavedCal = !!selectedPart && tryLoadCalibration(selectedPart.type);
        this._setDisplay(doc, 'ps-recal', hasSavedCal);

        this._setDisabled(doc.getElementById('ps-play'), !hasPart);

        this._setDisplay(doc, 'ps-instrument-dropdown', playableParts.length > 1);
        if (playableParts.length > 1) this._wireInstrumentDropdown(doc, playableParts, rerender);

        const availableDifficulties = selectedPart?.availableDifficulties ?? [];
        this._setDisplay(doc, 'ps-difficulty-dropdown', availableDifficulties.length > 0);
        if (availableDifficulties.length > 0) this._wireDifficultyDropdown(doc, availableDifficulties, rerender);

        if (!hasPart || !selectedPart) return;

        const partName = selectedPart.name;
        // Committed on actually starting to play, not on mere dropdown selection — same
        // "written at the point of use" convention CalibrationSystem's saves already follow.
        const commitInstrument = (): void => {
            const s = loadSettings();
            s.lastInstrumentType = selectedPart.type;
            saveSettings(s);
        };

        if (hasSavedCal) {
            this._setClick(doc, 'ps-play',  () => { commitInstrument(); onPlay(sourced, partName); });
            this._setClick(doc, 'ps-recal', () => { commitInstrument(); onReposition(sourced, partName); });
        } else {
            this._setClick(doc, 'ps-play', () => { commitInstrument(); onCalibratePlay(sourced, partName); });
        }
    }

    // Instrument dropdown popover — same shape as Play's Difficulty (renderDynamic(), since the
    // option count/labels vary per song).
    private _wireInstrumentDropdown(doc: UIKitDocument, playableParts: SongIndexPart[], rerender: () => void): void {
        const selected = this._selectedPart;
        const label = (part: SongIndexPart): string => PART_LABEL[part.type] ?? part.type;
        this._instrumentDropdown.setTriggerLabel(
            doc, selected ? `Instrument: ${label(selected)}` : 'Instrument', 'option-label',
        );

        const options: DynamicOption[] = playableParts.map(part => ({
            label: label(part),
            selected: part.name === selected?.name,
            onSelect: () => this._selectInstrument(part),
        }));

        this._instrumentDropdown.renderDynamic(doc, options, OPTION_MENU_LAYOUT, rerender);
    }

    // Switching Instrument retargets Difficulty to the nearest percentage in the new part's list
    // instead of resetting to 100% — see DifficultyDropdownPlan.md's "Phase 3 detail".
    private _selectInstrument(part: SongIndexPart): void {
        const oldDifficulties = this._selectedPart?.availableDifficulties;
        const newDifficulties = part.availableDifficulties;

        if (oldDifficulties?.length && this._selectedDifficulty != null && newDifficulties?.length) {
            const oldSorted = [...oldDifficulties].sort((a, b) => a - b);
            const newSorted = [...newDifficulties].sort((a, b) => a - b);
            const oldRank = oldSorted.indexOf(this._selectedDifficulty) + 1;
            const newRank = nearestRankForPercentage(oldRank, oldSorted.length, newSorted.length);
            this._selectedDifficulty = newSorted[newRank - 1];
        } else {
            this._selectedDifficulty = null;
        }

        this._selectedPart = part;
    }

    // Difficulty dropdown popover — same shape/logic as Play's (see XRActiveScene.ts), reused
    // here rather than duplicated since the label math is shared (OptionDropdown.ts).
    private _wireDifficultyDropdown(doc: UIKitDocument, availableDifficulties: number[], rerender: () => void): void {
        const sorted = [...availableDifficulties].sort((a, b) => a - b);
        const max = sorted[sorted.length - 1];
        const count = sorted.length;

        if (this._selectedDifficulty == null) this._selectedDifficulty = max;

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

    private _setDisplay(doc: UIKitDocument, id: string, visible: boolean): void {
        doc.getElementById(id)?.setProperties({ display: visible ? 'flex' : 'none' });
    }

    private _setClick(doc: UIKitDocument, id: string, onClick: () => void): void {
        doc.getElementById(id)?.setProperties({ onClick });
    }

    // uikit has no native `disabled` attribute — .disabled (pointer-events:none +
    // dimmed opacity, see ui/song.uikitml) stands in for it. classList.remove()
    // warns if the class isn't currently present, so guard with contains() first
    // (same pattern as XRSettingsScene's _setActiveClass/_setSwatch).
    private _setDisabled(el: ReturnType<UIKitDocument['getElementById']>, disabled: boolean): void {
        if (!el) return;
        if (disabled) {
            if (!el.classList.contains('disabled')) el.classList.add('disabled');
        } else {
            if (el.classList.contains('disabled')) el.classList.remove('disabled');
        }
    }
}
