import type { XrButton } from "./XRTypes.js";
import type { SongPlayer } from "./SongPlayer.js";
import type { SongSection } from "./SongFormat.js";

// ── XRActiveScene ─────────────────────────────────────────────────────────────

export class XRActiveScene {
    show(
        uiPanel: HTMLDivElement,
        xrButtons: XrButton[],
        songTitle: string,
        songArtist: string,
        songPlayer: SongPlayer,
        totalDuration: number,
        sections: SongSection[],
        // Starts recalibration; calls done() when the user presses Done in fine-tune.
        startCalibration: (done: () => void) => void,
        // Pause + 3s rollback + 3-2-1 countdown, then resume.
        onResumeWithCountdown: (pausedAt: number) => void,
        onSettings: () => void,
        // Register a callback HighwaySystem calls before each html2canvas render.
        registerPanelUpdate: (cb: () => void) => void,
        onBack: () => void,
    ): void {
        const speedLabel = (r: number) =>
            (Math.round(r * 100) / 100).toString().replace(/\.?0+$/, '') + '×';

        // Section tick marks — absolute-positioned inside the seek track.
        const sectionTicks = totalDuration > 0
            ? sections
                .filter(s => s.StartTime != null && s.StartTime > 0)
                .map(s => {
                    const pct = Math.min((s.StartTime! / totalDuration) * 100, 100);
                    return `<div style="position:absolute;left:${pct}%;top:0;width:2px;height:100%;` +
                           `background:#ccc;opacity:0.4;pointer-events:none"></div>`;
                })
                .join('')
            : '';

        uiPanel.innerHTML = `
            <div class="frame">
                <div class="content">
                    <div class="play-header">
                        <button class="button primary-dark" id="as-library" type="button">
                            <span class="back-icon">←</span>
                            <span>Library</span>
                        </button>
                        <button class="button primary-dark" id="as-settings" type="button">
                            <span>⚙</span>
                            <span>Settings</span>
                        </button>
                    </div>
                    <div class="play-body">
                        <div class="progress-row">
                            <div class="progress-area">
                                <div class="times">
                                    <span id="as-time" class="time-elapsed">0:00</span>
                                    <span class="time-total">${formatTime(totalDuration)}</span>
                                </div>
                                <div id="as-seek-track" class="seek-track">
                                    <div id="as-seek-fill" class="seek-fill"></div>
                                    ${sectionTicks}
                                    <div id="as-seek-thumb" class="seek-thumb"></div>
                                </div>
                            </div>
                            <button id="as-playpause" class="play-btn${songPlayer.isPlaying ? ' is-playing' : ''}" type="button">
                                <img src="/ui/${songPlayer.isPlaying ? 'pause' : 'play'}.svg" width="24" height="24" style="display:block">
                            </button>
                        </div>
                        <div class="song-row">
                            <div class="art-thumb"></div>
                            <div class="song-meta">
                                <p class="song-title">${esc(songTitle)}</p>
                                <p class="song-subtitle">${esc(songArtist)}</p>
                            </div>
                            <div class="speed-control">
                                <span class="speed-label">Speed</span>
                                <div class="speed-row">
                                    <button id="as-speed-dec" class="button secondary-dark speed-btn" type="button">−</button>
                                    <span id="as-speed-val" class="speed-value">${speedLabel(songPlayer.playbackRate)}</span>
                                    <button id="as-speed-inc" class="button secondary-dark speed-btn" type="button">+</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="actions">
                    <button class="button primary-dark" id="as-reposition" type="button">🔄 Reposition</button>
                </div>
            </div>
        `;

        const rerender = () => {
            this.show(
                uiPanel, xrButtons, songTitle, songArtist, songPlayer,
                totalDuration, sections, startCalibration,
                onResumeWithCountdown, onSettings, registerPanelUpdate, onBack,
            );
        };

        const libraryEl   = uiPanel.querySelector('#as-library')    as HTMLButtonElement;
        const settingsEl  = uiPanel.querySelector('#as-settings')   as HTMLButtonElement;
        const playEl      = uiPanel.querySelector('#as-playpause')  as HTMLButtonElement;
        const reposEl     = uiPanel.querySelector('#as-reposition') as HTMLButtonElement;
        const sdwnEl      = uiPanel.querySelector('#as-speed-dec')  as HTMLButtonElement;
        const supEl       = uiPanel.querySelector('#as-speed-inc')  as HTMLButtonElement;
        const seekTrack   = uiPanel.querySelector('#as-seek-track') as HTMLDivElement;
        const seekFill    = uiPanel.querySelector('#as-seek-fill')  as HTMLDivElement;
        const seekThumb   = uiPanel.querySelector('#as-seek-thumb') as HTMLDivElement;
        const timeEl      = uiPanel.querySelector('#as-time')       as HTMLSpanElement;

        // Per-frame DOM update: seek fill width, thumb position, time label.
        registerPanelUpdate(() => {
            const t   = songPlayer.currentSecond;
            const pct = totalDuration > 0 ? Math.min(t / totalDuration * 100, 100) : 0;
            seekFill.style.width = `${pct}%`;
            timeEl.textContent   = formatTime(t);
            const trackW = seekTrack.offsetWidth || (seekTrack.getBoundingClientRect().width) || 356;
            seekThumb.style.left = `${Math.max(0, Math.min(Math.round(pct / 100 * trackW) - 10, trackW - 20))}px`;
        });

        // Play / Pause
        xrButtons.push({
            el: playEl,
            onClick: () => {
                if (songPlayer.isPlaying) {
                    songPlayer.pause();
                    rerender();
                } else {
                    onResumeWithCountdown(songPlayer.currentSecond);
                }
            },
        });

        // Seek bar — drag-to-scrub.
        let scrubWasPlaying = false;
        xrButtons.push({
            el: seekTrack,
            onScrubStart: () => {
                scrubWasPlaying = songPlayer.isPlaying;
                if (scrubWasPlaying) songPlayer.pause();
            },
            onScrubMove: (normalizedX: number) => {
                songPlayer.seekTo(Math.max(0, Math.min(normalizedX * totalDuration, totalDuration)));
            },
            onScrubEnd: (normalizedX: number) => {
                const t = Math.max(0, Math.min(normalizedX * totalDuration, totalDuration));
                songPlayer.seekTo(t);
                if (scrubWasPlaying) {
                    onResumeWithCountdown(t);
                } else {
                    rerender();
                }
            },
        });

        // Speed [−]
        xrButtons.push({
            el: sdwnEl,
            onClick: () => {
                songPlayer.playbackRate = Math.max(0.1, Math.round((songPlayer.playbackRate - 0.1) * 10) / 10);
                rerender();
            },
        });

        // Speed [+]
        xrButtons.push({
            el: supEl,
            onClick: () => {
                songPlayer.playbackRate = Math.min(2.0, Math.round((songPlayer.playbackRate + 0.1) * 10) / 10);
                rerender();
            },
        });

        // Reposition
        xrButtons.push({
            el: reposEl,
            onClick: () => {
                if (songPlayer.isPlaying) songPlayer.pause();
                startCalibration(() => rerender());
            },
        });

        // Settings
        xrButtons.push({
            el: settingsEl,
            onClick: () => {
                if (songPlayer.isPlaying) songPlayer.pause();
                onSettings();
            },
        });

        // Back to library
        xrButtons.push({ el: libraryEl, onClick: onBack });
    }
}

function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function esc(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
