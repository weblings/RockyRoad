// ISongPlayer is the stable interface both playback backends must implement.
// SongPlayer uses AudioBufferSourceNode.playbackRate (Option A — pitch shifts proportionally).
// A future TimestretcSongPlayer can implement the same interface using a WASM time-stretcher
// (SoundTouch.js or similar) and drop in with no changes to callers.
export interface ISongPlayer {
    readonly isPlaying: boolean;
    readonly currentSecond: number;
    readonly duration: number;
    playbackRate: number;   // 0.25–2.0; Option A changes pitch; Option B will not
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
    }

    async loadSong(url: string): Promise<void> {
        if (!this.context) this.context = new AudioContext();
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
        const arrayBuffer = await response.arrayBuffer();
        this.buffer = await this.context.decodeAudioData(arrayBuffer);
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
            this.source.connect(this.context.destination);
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
