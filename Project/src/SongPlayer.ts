export class SongPlayer {
    private context: AudioContext | null = null;
    private buffer: AudioBuffer | null = null;
    private source: AudioBufferSourceNode | null = null;
    private startContextTime = 0; // context.currentTime when playback began at pausedAt
    private pausedAt = 0;         // seconds into the song where playback is paused
    private _playing = false;

    get isPlaying(): boolean { return this._playing; }

    get currentSecond(): number {
        if (this._playing && this.context) {
            return this.context.currentTime - this.startContextTime;
        }
        return this.pausedAt;
    }

    async loadSong(url: string): Promise<void> {
        this.context = new AudioContext();
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        this.buffer = await this.context.decodeAudioData(arrayBuffer);
    }

    play(): void {
        if (!this.context || !this.buffer || this._playing) return;

        // Resume context if it was suspended before a user gesture
        this.context.resume();

        this.source = this.context.createBufferSource();
        this.source.buffer = this.buffer;
        this.source.connect(this.context.destination);

        this.startContextTime = this.context.currentTime - this.pausedAt;
        this.source.start(0, this.pausedAt);
        const thisSource = this.source;
        this.source.onended = () => {
            // Only mark stopped if this source is still the active one —
            // a seek creates a new source and stops the old one, so the
            // old onended must not clobber the new playback state.
            if (this.source === thisSource) this._playing = false;
        };
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
