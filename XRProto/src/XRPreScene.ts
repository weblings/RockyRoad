import type { XrButton } from "./XRTypes.js";
import type { SongManifestEntry } from "./XRSongLibrary.js";

// ── XRPreScene ────────────────────────────────────────────────────────────────

export class XRPreScene {
    show(
        uiPanel: HTMLDivElement,
        xrButtons: XrButton[],
        entry: SongManifestEntry,
        // Returns true if a saved calibration was found and applied.
        tryLoadCalibration: () => boolean,
        // Saved calibration exists — load song and go straight to active scene.
        onPlay: (entry: SongManifestEntry, partName: string) => void,
        // No saved calibration — load song first (highway visible), then full 3-step calibrate.
        onCalibratePlay: (entry: SongManifestEntry, partName: string) => void,
        // Saved calibration exists — load song then open fine-tune panel directly.
        onReposition: (entry: SongManifestEntry, partName: string) => void,
        onBack: () => void,
    ): void {
        // Only show Keys parts — guitar/bass are not supported in XRProto v1.
        const keysParts = entry.parts.filter(p => p.type === 'Keys');
        const hasKeys   = keysParts.length > 0;

        // Default to the first Keys part, or the first part overall.
        const selectedPart = keysParts[0] ?? entry.parts[0];

        const btnStyle =
            'display:block;width:100%;padding:10px;margin-bottom:8px;border:none;' +
            'border-radius:5px;font-size:14px;cursor:pointer;box-sizing:border-box';
        const backStyle =
            'background:none;border:none;color:#aaa;font-size:12px;cursor:pointer;' +
            'padding:0;margin-bottom:12px';

        // Attempt to load saved calibration immediately.
        const hasSavedCal = hasKeys && tryLoadCalibration();

        const playBtnStyle = hasKeys
            ? `${btnStyle};background:#3a5a3a;color:#111`
            : `${btnStyle};background:#444;color:#555;cursor:default`;

        const calNote = hasSavedCal
            ? '<div style="font-size:11px;color:#8f8;margin-bottom:8px">✓ Calibration loaded</div>'
            : (hasKeys
                ? '<div style="font-size:11px;color:#fa8;margin-bottom:8px">Calibration required before playing</div>'
                : '<div style="font-size:11px;color:#f88;margin-bottom:8px">No Keys part in this song</div>');

        uiPanel.innerHTML = `
            <div style="padding:14px;font-family:sans-serif;color:#e8e8e8">
                <button id="ps-back" style="${backStyle}">← Library</button>
                <div style="font-size:16px;font-weight:bold;margin-bottom:2px">${esc(entry.title)}</div>
                <div style="font-size:12px;color:#aaa;margin-bottom:12px">${esc(entry.artist)}</div>
                ${calNote}
                ${hasSavedCal ? `<button id="ps-recal" style="${btnStyle};background:#3a3a6a;color:#111">🔄 Reposition Piano</button>` : ''}
                <button id="ps-play" style="${playBtnStyle}" ${hasKeys ? '' : 'disabled'}>
                    ${hasSavedCal ? '▶ Play' : '▶ Calibrate & Play'}
                </button>
            </div>
        `;

        // Back button.
        const backEl = uiPanel.querySelector('#ps-back') as HTMLButtonElement;
        xrButtons.push({ el: backEl, onClick: onBack });

        if (!hasKeys) return;

        const partName = selectedPart.name;

        // Play button — branches on whether calibration is already loaded.
        const playEl = uiPanel.querySelector('#ps-play') as HTMLButtonElement;
        if (hasSavedCal) {
            // Saved calibration applied — load song and go straight to active scene.
            xrButtons.push({ el: playEl, onClick: () => onPlay(entry, partName) });
        } else {
            // No calibration — load song first (highway visible), then calibrate.
            xrButtons.push({ el: playEl, onClick: () => onCalibratePlay(entry, partName) });
        }

        // Reposition Piano button — only shown when saved calibration was found.
        if (hasSavedCal) {
            const recalEl = uiPanel.querySelector('#ps-recal') as HTMLButtonElement;
            xrButtons.push({ el: recalEl, onClick: () => onReposition(entry, partName) });
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
