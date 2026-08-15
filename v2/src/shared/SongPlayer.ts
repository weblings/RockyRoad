import { SoundTouchNode } from '@soundtouchjs/audio-worklet';
import type { ProcessorMetrics } from '@soundtouchjs/audio-worklet';
import soundTouchProcessorUrl from '@soundtouchjs/audio-worklet/processor?url';

// ISongPlayer is the stable interface both playback backends must implement.
// SongPlayer's playbackRate is pitch-compensated via a SoundTouch AudioWorklet (see
// SoundTouchSpeedPlan.md), falling back to uncorrected native playback if it fails to load.
export interface ISongPlayer {
    readonly isPlaying: boolean;
    readonly currentSecond: number;
    readonly duration: number;
    playbackRate: number;   // 0.25–2.0; pitch-corrected via SoundTouch when the worklet is available
    play(): void;
    pause(): void;
    seekTo(seconds: number): void;
}

// No-op player for songs without audio (e.g. piano-only charts with no song.ogg).
// Advances currentSecond in real time using performance.now() so scene timing works normally.
export class SilentPlayer implements ISongPlayer {
    private _duration: number;
    private _playing = false;
    private _rate = 1;
    private _pausedAt = 0;
    private _startedAt = 0;

    constructor(duration: number) { this._duration = duration; }

    get isPlaying(): boolean { return this._playing; }
    get duration(): number { return this._duration; }
    get currentSecond(): number {
        if (!this._playing) return this._pausedAt;
        return this._pausedAt + (performance.now() - this._startedAt) / 1000 * this._rate;
    }
    get playbackRate(): number { return this._rate; }
    set playbackRate(r: number) {
        if (this._playing) { this._pausedAt = this.currentSecond; this._startedAt = performance.now(); }
        this._rate = r;
    }
    play(): void {
        if (this._playing) return;
        this._startedAt = performance.now();
        this._playing = true;
    }
    pause(): void {
        if (!this._playing) return;
        this._pausedAt = this.currentSecond;
        this._playing = false;
    }
    seekTo(seconds: number): void {
        this._pausedAt = seconds;
        if (this._playing) this._startedAt = performance.now();
    }
}

export class SongPlayer implements ISongPlayer {
    private context: AudioContext | null = null;
    private buffer: AudioBuffer | null = null;
    private source: AudioBufferSourceNode | null = null;
    // Absolute context time when play() was last called — elapsed = context.currentTime - startContextTime
    private startContextTime = 0;
    private pausedAt = 0;   // song position (seconds) at which playback was last paused/started
    private _playing = false;
    private _playbackRate = 1;
    // True once the worklet module has registered on this.context (one-time per context).
    private soundTouchRegistered = false;
    // Pitch-corrects speed changes; rebuilt alongside source on every play() (not long-lived)
    // since a fresh source would otherwise leave its internal WSOLA state stale. Null if the
    // worklet never registered — playback then falls back to native playbackRate.
    private stNode: SoundTouchNode | null = null;

    get isPlaying(): boolean { return this._playing; }

    get duration(): number { return this.buffer?.duration ?? 0; }

    get currentSecond(): number {
        if (this._playing && this.context) {
            // Multiply elapsed real time by playbackRate to get song-time elapsed.
            return this.pausedAt + (this.context.currentTime - this.startContextTime) * this._playbackRate;
        }
        return this.pausedAt;
    }

    get playbackRate(): number { return this._playbackRate; }

    set playbackRate(rate: number) {
        if (rate === this._playbackRate) return;
        if (this._playing && this.context) {
            // Re-anchor so currentSecond doesn't jump when rate changes mid-playback.
            // Capture the current song position, then reset the elapsed-time anchor.
            this.pausedAt = this.currentSecond;
            this.startContextTime = this.context.currentTime;
        }
        this._playbackRate = rate;
        if (this.source) this.source.playbackRate.value = rate;
        if (this.stNode) this.stNode.playbackRate.value = rate;
    }

    async loadSong(url: string): Promise<void> {
        if (!this.context) this.context = new AudioContext();
        if (!this.soundTouchRegistered) {
            try {
                await SoundTouchNode.register(this.context, soundTouchProcessorUrl);
                this.soundTouchRegistered = true;
            } catch (err) {
                // Graceful degradation — playback continues on native playbackRate, uncorrected.
                console.warn('SoundTouch worklet failed to load; pitch will shift with speed', err);
            }
        }
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
        const arrayBuffer = await response.arrayBuffer();
        this.buffer = await this.context.decodeAudioData(arrayBuffer);
    }

    // Builds a fresh SoundTouchNode wired to destination, rate synced from current state.
    // Called once per play() so a new source is never paired with a stale one (see stNode's
    // field comment). Returns null if the worklet never registered.
    private createSoundTouchNode(): SoundTouchNode | null {
        if (!this.soundTouchRegistered || !this.context) return null;
        const node = new SoundTouchNode({ context: this.context });
        node.connect(this.context.destination);
        // AudioParams reset to their default (1.0) on construction — sync explicitly rather than
        // relying on the playbackRate setter, which only fires on a subsequent rate change.
        node.playbackRate.value = this._playbackRate;
        // Surfaces real buffer starvation distinctly from WSOLA's inherent quality ceiling at
        // extreme speed ratios — see SoundTouchSpeedPlan.md Phase E. Silent when healthy.
        node.addEventListener('metrics', (e) => {
            const m = (e as CustomEvent<ProcessorMetrics>).detail;
            if (m.underrunCount > 0) {
                console.warn(`SoundTouch underruns: ${m.underrunCount}/${m.blockCount} blocks`, m);
            }
        });
        return node;
    }

    play(): void {
        if (this._playing) return;

        // Ensure a context exists even when no audio loaded — used as a pure clock.
        if (!this.context) this.context = new AudioContext();
        this.context.resume();

        // startContextTime is the raw context clock at the moment play() is called.
        // currentSecond = pausedAt + (context.currentTime - startContextTime) * rate
        this.startContextTime = this.context.currentTime;

        if (this.buffer) {
            this.source = this.context.createBufferSource();
            this.source.buffer = this.buffer;
            this.source.playbackRate.value = this._playbackRate;

            // Old stNode (if any) belonged to the previous source — disconnect it before
            // replacing, otherwise it stays wired to destination forever, idling on silence.
            this.stNode?.disconnect();
            this.stNode = this.createSoundTouchNode();
            if (this.stNode) this.source.connect(this.stNode);
            else this.source.connect(this.context.destination);

            this.source.start(0, this.pausedAt);

            const thisSource = this.source;
            this.source.onended = () => {
                // Guard against a seek (which stops the old source) clobbering new playback state.
                if (this.source === thisSource) {
                    this.pausedAt = this.buffer!.duration;
                    this._playing = false;
                }
            };
        }

        this._playing = true;
    }

    pause(): void {
        if (!this.context || !this._playing) return;
        this.pausedAt = this.currentSecond;
        this.source?.stop();
        this.source = null;
        this._playing = false;
    }

    seekTo(seconds: number): void {
        const wasPlaying = this._playing;
        if (this._playing) {
            this.source?.stop();
            this.source = null;
            this._playing = false;
        }
        this.pausedAt = seconds;
        if (wasPlaying) this.play();
    }
}
