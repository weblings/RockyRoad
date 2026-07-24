import type { XrButton } from "./XRTypes";

// Manual scroll: `viewport` clips `inner`, which is translated via
// transform:translateY instead of native scrollTop — html2canvas can't
// capture scrollTop, so position has to live in a property it does capture.
// track/thumb are driven the same way as the seek bar in XRActiveScene:
// registered as a scrubVertical xrButton, not real DOM scroll events.
// Originally lived inline in XRSongLibrary; extracted so XRSettingsScene can
// reuse it too (both guitar and keys sections, via the same settings-body wrapper).

export interface ScrollListRefs {
    viewport: HTMLElement;
    inner: HTMLElement;
    track: HTMLElement;
    thumb: HTMLElement;
    // Restores a previously-tracked scroll position (e.g. across a full
    // rerender that recreates the DOM from scratch). Clamped to the new
    // maxOffset on the first recompute() same as any other change.
    initialOffset?: number;
    // Fired whenever the effective scroll offset changes (recompute or drag) —
    // callers that rerender from scratch on every interaction (like
    // XRSettingsScene) use this to persist the offset across renders via
    // initialOffset on the next call.
    onOffsetChange?: (offset: number) => void;
}

export interface ScrollListHandle {
    // Call after the list content's height changes (e.g. filtering). Pass
    // resetToTop when the content should snap back to the top (e.g. a new
    // search query), rather than preserving the current offset.
    recompute: (resetToTop?: boolean) => void;
}

export function setupScrollList(refs: ScrollListRefs, xrButtons: XrButton[]): ScrollListHandle {
    const { viewport, inner, track, thumb, onOffsetChange } = refs;

    let scrollOffset = refs.initialOffset ?? 0;
    let maxOffset     = 0;

    const updateThumb = (): void => {
        if (maxOffset <= 0) {
            track.style.display = 'none';
            return;
        }
        track.style.display = '';
        const trackH = track.clientHeight;
        const totalH = inner.offsetHeight;
        const viewH  = viewport.clientHeight;
        const thumbH = totalH > 0
            ? Math.max(24, Math.round((viewH / totalH) * trackH))
            : trackH;
        const norm     = scrollOffset / maxOffset;
        const thumbTop = Math.round(norm * (trackH - thumbH));
        thumb.style.height = `${thumbH}px`;
        thumb.style.top    = `${thumbTop}px`;
    };

    const recompute = (resetToTop = false): void => {
        if (resetToTop) scrollOffset = 0;
        // Reading offsetHeight forces a synchronous reflow — correct after innerHTML changes.
        maxOffset    = Math.max(0, inner.offsetHeight - viewport.clientHeight);
        scrollOffset = Math.min(scrollOffset, maxOffset);
        inner.style.transform = `translateY(-${scrollOffset}px)`;
        updateThumb();
        onOffsetChange?.(scrollOffset);
    };

    const applyScroll = (ny: number): void => {
        scrollOffset = ny * maxOffset;
        inner.style.transform = `translateY(-${scrollOffset}px)`;
        updateThumb();
        // Do NOT call onInvalidate() here: it would cancel an in-flight
        // html2canvas capture on every drag frame, so no captures ever
        // complete during a scroll. The render loop picks up the new
        // transform on its next cycle naturally.
        onOffsetChange?.(scrollOffset);
    };

    recompute();

    if (maxOffset > 0) {
        xrButtons.push({
            el: track,
            scrubVertical: true,
            onScrubStart: () => {},
            onScrubMove:  (ny) => applyScroll(ny),
            onScrubEnd:   (ny) => applyScroll(ny),
        });
    }

    return { recompute };
}
