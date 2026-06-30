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

        // Attempt to load saved calibration immediately.
        const hasSavedCal = hasKeys && tryLoadCalibration();

        uiPanel.innerHTML = `
            <div class="frame">
                <div class="content">
                    <div class="header">
                        <button id="ps-back" class="button primary-dark" type="button">
                            <span class="back-icon">←</span>
                            <span class="back-label">Library</span>
                        </button>
                    </div>
                    <div class="song-info">
                        <div class="song-details">
                            <div class="row">
                                <div class="art-bg"><div class="art-image"></div></div>
                            </div>
                            <p class="song-title">${esc(entry.title)}</p>
                            <div class="row">
                                <div class="text-wrap"><p class="artist-name">${esc(entry.artist)}</p></div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="actions">
                    ${hasSavedCal
                        ? `<button id="ps-recal" class="button primary-dark" type="button">🔄 Reposition</button>`
                        : ''}
                    <button id="ps-play" class="button primary-light" type="button"
                        ${hasKeys ? '' : 'disabled'}>▶ Play</button>
                </div>
            </div>
        `;

        xrButtons.push({
            el: uiPanel.querySelector('#ps-back') as HTMLButtonElement,
            onClick: onBack,
        });

        if (!hasKeys) return;

        const partName = selectedPart.name;

        const playEl = uiPanel.querySelector('#ps-play') as HTMLButtonElement;
        if (hasSavedCal) {
            xrButtons.push({ el: playEl, onClick: () => onPlay(entry, partName) });

            const recalEl = uiPanel.querySelector('#ps-recal') as HTMLButtonElement;
            xrButtons.push({ el: recalEl, onClick: () => onReposition(entry, partName) });
        } else {
            xrButtons.push({ el: playEl, onClick: () => onCalibratePlay(entry, partName) });
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
