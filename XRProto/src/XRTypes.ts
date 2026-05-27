/** Tracks a DOM element for ray hit-test interaction in XR. */
export interface XrButton {
    el: HTMLElement;
    onClick?: () => void;
    // For seek bars: called with normalised X position within the element (0–1).
    onClickAt?: (normalizedX: number) => void;
}
