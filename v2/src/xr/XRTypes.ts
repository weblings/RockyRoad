/** Tracks a DOM element for ray hit-test interaction in XR. */
export interface XrButton {
    el: HTMLElement;
    onClick?: () => void;
    // Drag-to-scrub: trigger-down starts, held frames move, trigger-up ends.
    // Set scrubVertical:true to track Y instead of X (e.g. a scrollbar).
    onScrubStart?:   () => void;
    onScrubMove?:    (normalized: number) => void;
    onScrubEnd?:     (normalized: number) => void;
    scrubVertical?:  boolean;
}
