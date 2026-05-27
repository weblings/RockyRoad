/** Tracks a DOM element for ray hit-test interaction in XR. */
export interface XrButton {
    el: HTMLElement;
    onClick?: () => void;
    // Drag-to-scrub: trigger-down starts, held frames move, trigger-up ends.
    onScrubStart?: () => void;
    onScrubMove?:  (normalizedX: number) => void;
    onScrubEnd?:   (normalizedX: number) => void;
}
