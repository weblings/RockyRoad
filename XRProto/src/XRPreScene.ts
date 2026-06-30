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
                        <button id="ps-back" class="button primary-dark icon-btn" type="button">
                            <svg width="14" height="14" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M13.0908 14.3334C12.972 14.3334 12.9125 14.1898 12.9965 14.1058L17.7021 9.40022C17.9625 9.13987 17.9625 8.71776 17.7021 8.45741L16.2879 7.04319C16.0275 6.78284 15.6054 6.78284 15.3451 7.04319L6.8598 15.5285C6.59945 15.7888 6.59945 16.2109 6.8598 16.4713L8.27401 17.8855L8.27536 17.8868L15.3453 24.9568C15.6057 25.2172 16.0278 25.2172 16.2881 24.9568L17.7024 23.5426C17.9627 23.2822 17.9627 22.8601 17.7024 22.5998L12.9969 17.8944C12.9129 17.8104 12.9724 17.6668 13.0912 17.6668L26 17.6668C26.3682 17.6668 26.6667 17.3683 26.6667 17.0001V15.0001C26.6667 14.6319 26.3682 14.3334 26 14.3334L13.0908 14.3334Z" fill="currentColor"/></svg>
                            <span>Library</span>
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
