// Shared 3-2-1 timer. start() always invalidates any run in flight, and cancel()
// drops the pending ticks. Callers own the display and what happens on completion.
export class CountdownTimer {
    private gen = 0;
    private active = false;

    get isActive(): boolean { return this.active; }

    start(onTick: (n: number) => void, onDone: () => void): void {
        const gen = ++this.gen;
        this.active = true;
        onTick(3);
        setTimeout(() => { if (gen === this.gen) onTick(2); }, 1000);
        setTimeout(() => { if (gen === this.gen) onTick(1); }, 2000);
        setTimeout(() => {
            if (gen !== this.gen) return;
            this.active = false;
            onDone();
        }, 3000);
    }

    // Returns whether a countdown was actually pending.
    cancel(): boolean {
        const wasActive = this.active;
        this.gen++;
        this.active = false;
        return wasActive;
    }
}
