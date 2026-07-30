import type { Entity, UIKitDocument } from "@iwsdk/core";
import { PanelDocument } from "@iwsdk/core";
import type { SourcedEntry } from "../shared/SongSource";

// ── XRPreScene ────────────────────────────────────────────────────────────────
// uikit-based (see ui/song.uikitml) — migrated off html2canvas following the
// same pattern as XRSettingsScene.ts. Unlike Settings, nothing on this screen
// changes after it's shown (no toggles/state to re-render), so _render() runs
// once per show() call rather than looping via a rerender() callback.

export class XRPreScene {
    // Resolved once (the panel entity/document are created once and persist —
    // see preScenePanelEntity in index.ts), then reused across every show().
    private _doc: UIKitDocument | null = null;

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
        const { entry } = sourced;

        this._setClick(doc, 'ps-back', onBack);

        doc.getElementById('ps-song-title')?.setProperties({ text: entry.songName });
        doc.getElementById('ps-artist-name')?.setProperties({ text: entry.artistName });

        const artUrl = sourced.source.getAlbumArtUrl(entry);
        const artEl = doc.getElementById('ps-art-img');
        if (artUrl) {
            artEl?.setProperties({ display: 'flex', src: artUrl });
        } else {
            artEl?.setProperties({ display: 'none' });
        }

        // Prefer a Keys part if present, otherwise the first part overall (Guitar/Bass).
        const hasPart = entry.parts.length > 0;
        const selectedPart = entry.parts.find(p => p.type === 'Keys') ?? entry.parts[0];

        // Attempt to load saved calibration immediately.
        const hasSavedCal = hasPart && tryLoadCalibration(selectedPart.type);

        this._setDisplay(doc, 'ps-recal', hasSavedCal);

        const playEl = doc.getElementById('ps-play');
        this._setDisabled(playEl, !hasPart);

        if (!hasPart) return;

        const partName = selectedPart.name;

        if (hasSavedCal) {
            this._setClick(doc, 'ps-play',  () => onPlay(sourced, partName));
            this._setClick(doc, 'ps-recal', () => onReposition(sourced, partName));
        } else {
            this._setClick(doc, 'ps-play', () => onCalibratePlay(sourced, partName));
        }
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
