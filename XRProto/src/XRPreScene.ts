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
                        ? `<button id="ps-recal" class="button primary-dark icon-btn" type="button"><svg width="14" height="14" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M22.1969 4.98846C21.7569 4.66331 21.1341 4.97748 21.1341 5.52465V7.20266C21.1341 7.27629 21.0744 7.33599 21.0008 7.33599H11.1341C8.18859 7.33599 5.80078 9.72381 5.80078 12.6693V14.6693C5.80078 15.0375 6.09925 15.336 6.46744 15.336H8.20078C8.56897 15.336 8.86744 15.0375 8.86744 14.6693V13.0691C8.86744 11.5963 10.0613 10.4024 11.5341 10.4024H21.0008C21.0744 10.4024 21.1341 10.4621 21.1341 10.5357V12.215C21.1341 12.7621 21.7569 13.0763 22.197 12.7511L26.7242 9.40583C27.0849 9.13934 27.0849 8.59995 26.7242 8.33347L22.1969 4.98846Z" fill="currentColor"/><path d="M16 18.0001C17.1046 18.0001 18 17.1046 18 16.0001C18 14.8955 17.1046 14.0001 16 14.0001C14.8954 14.0001 14 14.8955 14 16.0001C14 17.1046 14.8954 18.0001 16 18.0001Z" fill="currentColor"/><path d="M20.8652 24.6641H10.9986C10.9249 24.6641 10.8652 24.7238 10.8652 24.7975V26.4755C10.8652 27.0226 10.2425 27.3368 9.80241 27.0116L5.27514 23.6666C4.91448 23.4002 4.91447 22.8608 5.27512 22.5943L9.80239 19.249C10.2425 18.9238 10.8652 19.238 10.8652 19.7851V21.4644C10.8652 21.538 10.9249 21.5977 10.9986 21.5977H20.4652C21.938 21.5977 23.1319 20.4038 23.1319 18.931V17.3308C23.1319 16.9626 23.4304 16.6641 23.7986 16.6641H25.5319C25.9001 16.6641 26.1986 16.9626 26.1986 17.3308V19.3308C26.1986 22.2763 23.8108 24.6641 20.8652 24.6641Z" fill="currentColor"/></svg><span>Reposition</span></button>`
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
