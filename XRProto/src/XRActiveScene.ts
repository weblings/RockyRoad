import type { XrButton } from "./XRTypes.js";
import type { SongPlayer } from "./SongPlayer.js";
import type { SongSection } from "./SongFormat.js";

// ── XRActiveScene ─────────────────────────────────────────────────────────────

export class XRActiveScene {
    show(
        uiPanel: HTMLDivElement,
        xrButtons: XrButton[],
        songTitle: string,
        songPlayer: SongPlayer,
        totalDuration: number,
        sections: SongSection[],
        // Starts recalibration; calls done() when the user presses Done in fine-tune.
        startCalibration: (done: () => void) => void,
        // Pause + 3s rollback + 3-2-1 countdown, then resume.
        onResumeWithCountdown: (pausedAt: number) => void,
        // Register a callback HighwaySystem calls before each html2canvas render.
        registerPanelUpdate: (cb: () => void) => void,
        onBack: () => void,
    ): void {
        const btnStyle =
            'display:block;width:100%;padding:10px;margin-bottom:8px;border:none;' +
            'border-radius:5px;font-size:14px;cursor:pointer;box-sizing:border-box;color:#111';
        const smallBtn =
            'display:block;width:100%;padding:7px;margin-bottom:6px;border:none;' +
            'border-radius:5px;font-size:12px;cursor:pointer;box-sizing:border-box;color:#111';
        const speedBtnStyle =
            'flex:0 0 auto;padding:4px 14px;border:none;border-radius:4px;' +
            'font-size:15px;cursor:pointer;color:#111;background:#555';

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
            <div style="padding:14px;font-family:sans-serif;color:#e8e8e8">
                <div style="font-size:13px;font-weight:bold;margin-bottom:6px;
                            white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                    🎹 ${esc(songTitle)}
                </div>
                <div style="display:flex;justify-content:space-between;
                            font-size:11px;color:#aaa;margin-bottom:4px">
                    <span id="as-time">0:00</span>
                    <span>${formatTime(totalDuration)}</span>
                </div>
                <div id="as-seek-track"
                     style="position:relative;width:100%;height:14px;background:#555;
                            border-radius:7px;margin-bottom:10px;cursor:pointer;
                            box-sizing:border-box">
                    <div id="as-seek-fill"
                         style="position:absolute;left:0;top:0;height:100%;
                                background:#6aaa6a;border-radius:7px;width:0%"></div>
                    ${sectionTicks}
                    <div id="as-seek-thumb"
                         style="position:absolute;top:-3px;width:20px;height:20px;
                                background:#9aca9a;border-radius:50%;left:0px;
                                box-shadow:0 0 3px rgba(0,0,0,0.6)"></div>
                </div>
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
                    <button id="as-speed-down" style="${speedBtnStyle}">−</button>
                    <span style="flex:1;text-align:center;font-size:12px;color:#ccc">
                        ${speedLabel(songPlayer.playbackRate)}
                    </span>
                    <button id="as-speed-up" style="${speedBtnStyle}">+</button>
                </div>
                <button id="as-playpause" style="${btnStyle}background:#3a5a3a">
                    ${songPlayer.isPlaying ? '⏸ Pause' : '▶ Play'}
                </button>
                <button id="as-recal" style="${smallBtn}background:#3a3a6a">
                    🔄 Recalibrate Piano
                </button>
                <button id="as-back" style="${smallBtn}background:#5a3a3a">
                    ← Library
                </button>
            </div>
        `;

        const rerender = () => {
            this.show(
                uiPanel, xrButtons, songTitle, songPlayer,
                totalDuration, sections, startCalibration,
                onResumeWithCountdown, registerPanelUpdate, onBack,
            );
        };

        const playEl    = uiPanel.querySelector('#as-playpause')  as HTMLButtonElement;
        const recalEl   = uiPanel.querySelector('#as-recal')      as HTMLButtonElement;
        const backEl    = uiPanel.querySelector('#as-back')       as HTMLButtonElement;
        const sdwnEl    = uiPanel.querySelector('#as-speed-down') as HTMLButtonElement;
        const supEl     = uiPanel.querySelector('#as-speed-up')   as HTMLButtonElement;
        const seekTrack = uiPanel.querySelector('#as-seek-track') as HTMLDivElement;
        const seekFill  = uiPanel.querySelector('#as-seek-fill')  as HTMLDivElement;
        const seekThumb = uiPanel.querySelector('#as-seek-thumb') as HTMLDivElement;
        const timeEl    = uiPanel.querySelector('#as-time')       as HTMLSpanElement;

        // Per-frame DOM update: seek fill width, thumb position, time label.
        registerPanelUpdate(() => {
            const t   = songPlayer.currentSecond;
            const pct = totalDuration > 0 ? Math.min(t / totalDuration * 100, 100) : 0;
            seekFill.style.width = `${pct}%`;
            timeEl.textContent   = formatTime(t);
            // Position thumb centre at pct% of the track width; thumb is 20px wide.
            const trackW = seekTrack.offsetWidth || (seekTrack.getBoundingClientRect().width) || 372;
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
        // Visual (highway + seek bar) updates during drag; audio finalised on release.
        let scrubWasPlaying = false;
        xrButtons.push({
            el: seekTrack,
            onScrubStart: () => {
                scrubWasPlaying = songPlayer.isPlaying;
                if (scrubWasPlaying) songPlayer.pause();
            },
            onScrubMove: (normalizedX: number) => {
                // seekTo while paused just sets pausedAt — O(1), safe every frame.
                // HighwaySystem reads currentSecond to drive scene position.
                songPlayer.seekTo(Math.max(0, Math.min(normalizedX * totalDuration, totalDuration)));
            },
            onScrubEnd: (normalizedX: number) => {
                const t = Math.max(0, Math.min(normalizedX * totalDuration, totalDuration));
                songPlayer.seekTo(t); // ensures position set even on press-without-move
                if (scrubWasPlaying) {
                    onResumeWithCountdown(t);
                } else {
                    rerender();
                }
            },
        });

        // Speed [−] — 0.2 step to match 2D preset anchors, clamped to [0.2, 2.0]
        xrButtons.push({
            el: sdwnEl,
            onClick: () => {
                songPlayer.playbackRate = Math.max(0.2, Math.round((songPlayer.playbackRate - 0.2) * 10) / 10);
                rerender();
            },
        });

        // Speed [+]
        xrButtons.push({
            el: supEl,
            onClick: () => {
                songPlayer.playbackRate = Math.min(2.0, Math.round((songPlayer.playbackRate + 0.2) * 10) / 10);
                rerender();
            },
        });

        // Recalibrate — pause while calibrating, re-show panel when done.
        xrButtons.push({
            el: recalEl,
            onClick: () => {
                if (songPlayer.isPlaying) songPlayer.pause();
                startCalibration(() => rerender());
            },
        });

        // Back to library.
        xrButtons.push({ el: backEl, onClick: onBack });
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
