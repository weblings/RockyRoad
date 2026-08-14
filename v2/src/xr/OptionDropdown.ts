import type { UIKitDocument } from "@iwsdk/core";
import { UIKit } from "@iwsdk/core";
import type { Vector3 } from "three";

// uikit's own PointerEvent type lives in @pmndrs/pointer-events, not a direct dependency of this
// project (only transitive via @iwsdk/core) — this local shape covers the fields drag handlers need.
export type WorldPointerEvent = {
    point?: Vector3;
    pointerId: number;
    currentTarget?: {
        setPointerCapture?(pointerId: number): void;
        releasePointerCapture?(pointerId: number): void;
    };
};

export interface OptionDropdownIds {
    trigger: string;
    triggerLabelSlot: string;
    chevronDown: string;
    chevronUp: string;
    menu: string;
    menuInner: string;
}

export interface OptionDropdownItem {
    id: string;
    selected: boolean;
    // What picking this option should do — the dropdown itself always also closes and rerenders.
    onSelect: () => void;
}

// Same shape as OptionDropdownItem but for renderDynamic() — no id, since the element doesn't
// exist in markup yet; a label instead, since the element's text has to come from somewhere.
export interface DynamicOption {
    label: string;
    selected: boolean;
    onSelect: () => void;
}

export interface OptionMenuLayout {
    itemHeight: number;
    itemGap: number;
    menuHeight: number;
}

// Mirrors .option-item/.option-menu-inner/.option-menu in ui/play.uikitml, used to compute the
// dropdown's open-scroll target via arithmetic instead of live .size/.relativeCenter reads — those
// read [0,0] at the exact moment display flips to 'flex' (Yoga hasn't laid out the subtree yet).
// Pure function, no uikit dependency — testable without a headset.
export function computeCenteredOffset(
    selectedIndex: number,
    itemCount: number,
    layout: OptionMenuLayout,
): number | undefined {
    if (selectedIndex < 0) return undefined;
    const { itemHeight, itemGap, menuHeight } = layout;
    const distanceFromTop = selectedIndex * (itemHeight + itemGap) + itemHeight / 2;
    const contentHeight = itemCount * itemHeight + Math.max(0, itemCount - 1) * itemGap;
    const maxOffsetEstimate = Math.max(0, contentHeight - menuHeight);
    return Math.max(0, Math.min(distanceFromTop - menuHeight / 2, maxOffsetEstimate));
}

function setOptionSelected(el: ReturnType<UIKitDocument['getElementById']>, selected: boolean): void {
    if (!el) return;
    if (selected) { if (!el.classList.contains('option-item-selected')) el.classList.add('option-item-selected'); }
    else          { if (el.classList.contains('option-item-selected')) el.classList.remove('option-item-selected'); }
}

// A single trigger+popover dropdown (Play's Speed/Difficulty, Song's Instrument/Difficulty) — one
// instance per dropdown, each owning its own open/scroll/label state. Two ways to supply options:
// render() for a fixed, statically-declared list (Speed's markup always has all 10 buttons
// present); renderDynamic() for a list whose length/labels vary per song (Difficulty, Instrument).
export class OptionDropdown {
    // Backs the outside-click/sibling-close listener below — every instance registers against
    // whichever document it renders into (scoped per-document, not global, since screens are
    // always-mounted singletons that outlive being hidden — see ensureOutsideClickListener()).
    private static docRegistry = new WeakMap<UIKitDocument, Set<OptionDropdown>>();
    private static installedDocs = new WeakSet<UIKitDocument>();

    private ids: OptionDropdownIds;
    private menuOpen = false;
    private menuWasOpen = false;
    private triggerLabelNode: InstanceType<typeof UIKit.Text> | null = null;
    private optionNodes: InstanceType<typeof UIKit.Container>[] = [];
    private scrollOffset = 0;
    private lastRerender: (() => void) | null = null;
    // One-shot: set by the trigger's own onClick when it opens, consumed by
    // _closeIfClickWasOutside — see that handler's comment for why.
    private justOpenedByOwnClick = false;

    constructor(ids: OptionDropdownIds) {
        this.ids = ids;
    }

    get isOpen(): boolean {
        return this.menuOpen;
    }

    // Destroys/recreates the trigger's label node instead of mutating .text — mutating in place
    // left stale glyphs rendering behind new text (see .option-label in ui/play.uikitml).
    setTriggerLabel(doc: UIKitDocument, text: string, labelClass: string): void {
        const slot = doc.getElementById(this.ids.triggerLabelSlot);
        if (!slot) return;
        if (this.triggerLabelNode) slot.remove(this.triggerLabelNode);
        this.triggerLabelNode = new UIKit.Text({ text }, [labelClass]);
        slot.add(this.triggerLabelNode);
    }

    // Call every render. items describes the current, full option list, each already present in
    // markup with a known id — trigger/chevron/menu display, each option's selected state and
    // click, and open-scroll centering all get wired here.
    render(doc: UIKitDocument, items: OptionDropdownItem[], layout: OptionMenuLayout, rerender: () => void): void {
        this._registerWithDocument(doc, rerender);
        let selectedIndex = -1;
        items.forEach((item, i) => {
            const el = doc.getElementById(item.id);
            if (!el) return;
            if (item.selected) selectedIndex = i;
            this._wireOption(el, item.selected, item.onSelect, rerender);
        });
        this._afterOptionsWired(doc, selectedIndex, items.length, layout, rerender);
    }

    // Same as render(), but for an option count/labels that vary per song (menu-inner starts
    // empty in markup) — destroys and recreates UIKit.Container+Text option nodes each call, same
    // "destroy and recreate" pattern already used for section ticks and Library's song rows.
    renderDynamic(doc: UIKitDocument, options: DynamicOption[], layout: OptionMenuLayout, rerender: () => void): void {
        this._registerWithDocument(doc, rerender);
        const container = doc.getElementById(this.ids.menuInner);
        if (!container) return;
        for (const node of this.optionNodes) container.remove(node);
        this.optionNodes = [];

        let selectedIndex = -1;
        options.forEach((opt, i) => {
            // .option-item's markup counterpart is a <button>, which centers its text by
            // default — a plain Container doesn't, so it's set explicitly here.
            const node = new UIKit.Container({ justifyContent: 'center', alignItems: 'center' }, ['option-item']);
            node.add(new UIKit.Text({ text: opt.label }, []));
            if (opt.selected) selectedIndex = i;
            this._wireOption(node, opt.selected, opt.onSelect, rerender);
            container.add(node);
            this.optionNodes.push(node);
        });
        this._afterOptionsWired(doc, selectedIndex, options.length, layout, rerender);
    }

    private _wireOption(
        el: InstanceType<typeof UIKit.Container> | Exclude<ReturnType<UIKitDocument['getElementById']>, null>,
        selected: boolean,
        onSelect: () => void,
        rerender: () => void,
    ): void {
        setOptionSelected(el, selected);
        el.setProperties({
            onClick: () => {
                onSelect();
                this.menuOpen = false;
                rerender();
            },
        });
    }

    private _afterOptionsWired(
        doc: UIKitDocument,
        selectedIndex: number,
        itemCount: number,
        layout: OptionMenuLayout,
        rerender: () => void,
    ): void {
        doc.getElementById(this.ids.menu)?.setProperties({ display: this.menuOpen ? 'flex' : 'none' });
        doc.getElementById(this.ids.chevronDown)?.setProperties({ display: this.menuOpen ? 'none' : 'flex' });
        doc.getElementById(this.ids.chevronUp)?.setProperties({ display: this.menuOpen ? 'flex' : 'none' });
        doc.getElementById(this.ids.trigger)?.setProperties({
            onClick: () => {
                this.menuOpen = !this.menuOpen;
                // rerender() below runs setTriggerLabel(), which destroys/recreates the label
                // Text node on every call — if the click landed on that node, this severs its
                // .parent chain before the outside-click listener's containment check ever runs
                // (see _closeIfClickWasOutside). This flag lets that check skip straight past the
                // now-unreliable identity check: a trigger click can only ever be "inside" its own
                // dropdown by definition.
                if (this.menuOpen) this.justOpenedByOwnClick = true;
                rerender();
            },
        });

        // Recenter only on the open transition, not every rerender (e.g. Playpause) of an
        // already-open menu, which would fight the user's own scrolling.
        const justOpened = this.menuOpen && !this.menuWasOpen;
        this.menuWasOpen = this.menuOpen;

        const initialOffset = justOpened ? computeCenteredOffset(selectedIndex, itemCount, layout) : undefined;
        this._wireScroll(doc, initialOffset);
    }

    // Tracks this dropdown against the document it just rendered into, and lazily installs that
    // document's outside-click listener. Safe to call every render — Set/WeakSet membership makes
    // both steps no-ops past the first call, same "safe to rewire every rerender" idiom already
    // used for onClick above.
    private _registerWithDocument(doc: UIKitDocument, rerender: () => void): void {
        this.lastRerender = rerender;
        let dropdowns = OptionDropdown.docRegistry.get(doc);
        if (!dropdowns) {
            dropdowns = new Set();
            OptionDropdown.docRegistry.set(doc, dropdowns);
        }
        dropdowns.add(this);
        OptionDropdown.ensureOutsideClickListener(doc);
    }

    // XR counterpart to desktop's Dropdown outside-click/sibling-close fix (see
    // ThreeCP/Analysis/lessons/desktop-dom.md) — uikit click events bubble from the clicked element
    // up through .parent to doc.rootElement, the same way DOM clicks bubble to document. A trigger
    // click has already toggled its own dropdown's state by the time this runs (listeners on the
    // hit element itself fire before bubbling reaches root), so the containment check below both
    // closes genuinely-outside clicks and leaves a just-opened dropdown alone. Installed once per
    // document, lazily, on first render into it.
    private static ensureOutsideClickListener(doc: UIKitDocument): void {
        if (OptionDropdown.installedDocs.has(doc)) return;
        OptionDropdown.installedDocs.add(doc);
        doc.rootElement.setProperties({
            onClick: (e: { object?: NonNullable<ReturnType<UIKitDocument['getElementById']>> }) => {
                if (!e.object) return;
                const dropdowns = OptionDropdown.docRegistry.get(doc);
                if (!dropdowns) return;
                for (const dropdown of dropdowns) dropdown._closeIfClickWasOutside(doc, e.object);
            },
        });
    }

    private _closeIfClickWasOutside(doc: UIKitDocument, target: NonNullable<ReturnType<UIKitDocument['getElementById']>>): void {
        if (!this.menuOpen) return;
        if (this.justOpenedByOwnClick) {
            this.justOpenedByOwnClick = false;
            return;
        }
        const trigger = doc.getElementById(this.ids.trigger);
        const menu = doc.getElementById(this.ids.menu);
        const inside =
            (trigger != null && (trigger === target || doc.isDescendantOf(target, trigger))) ||
            (menu != null && (menu === target || doc.isDescendantOf(target, menu)));
        if (inside) return;
        this.menuOpen = false;
        this.lastRerender?.();
    }

    // Custom drag-to-scroll, replacing overflow:scroll — its capture/release object mismatch
    // wedges scroll permanently once a drag starts on a child button (nearly every gesture at this
    // popover's size). See ThreeCP/Analysis/lessons/ui-toolkit/scrolling-and-dropdowns.md.
    // Deliberately doesn't capture on every
    // pointerdown like _wireSeekDrag does: native click synthesis requires down/up to land on the
    // same object, so eager capture would break every option's onClick. Capture is deferred until
    // real drag distance is confirmed.
    //
    // initialOffset: pre-clamped scroll offset to open at (e.g. centered selection) — only set on
    // the render that just opened the menu; undefined otherwise so the user's own scroll position
    // is preserved.
    private _wireScroll(doc: UIKitDocument, initialOffset?: number): void {
        const menu = doc.getElementById(this.ids.menu);
        const inner = doc.getElementById(this.ids.menuInner);
        if (!menu || !inner) return;

        // Local-space movement (normalized -0.5..0.5, same units as WorldPointerEvent) past which
        // a press is promoted from "maybe a tap" to a real drag.
        const DRAG_THRESHOLD = 0.03;

        // pressed: is a pinch/click currently held. dragging: only meaningful while pressed, true
        // once movement crosses DRAG_THRESHOLD. Keep these separate — onPointerMove fires on every
        // hover, not just while pressed, so without the pressed gate a mere hover would "drag"
        // against a stale startLocalY (mirrors _wireSeekDrag's `if (!scrubbing) return;` guard).
        let pressed = false;
        let dragging = false;
        let startLocalY = 0;
        let startOffset = this.scrollOffset;

        const maxOffset = (): number => {
            const innerSize = inner.size.peek();
            const menuSize = menu.size.peek();
            if (!innerSize || !menuSize) return 0;
            return Math.max(0, innerSize[1] - menuSize[1]);
        };

        const applyOffset = (o: number): void => {
            const clamped = Math.max(0, Math.min(o, maxOffset()));
            this.scrollOffset = clamped;
            // position-top negative = shifted up, same convention as the seek-thumb's fixed
            // position-top:-0.3 — growing more negative as offset grows reveals lower content.
            inner.setProperties({ positionTop: -clamped });
        };

        if (initialOffset != null) {
            // Bypasses applyOffset's live maxOffset() clamp — inner.size/menu.size read [0,0] at
            // this exact synchronous point (Yoga hasn't laid out the newly-visible subtree yet),
            // which would clamp any nonzero target back to 0. The caller already computed and
            // clamped this analytically, so it's trustworthy as-is.
            this.scrollOffset = initialOffset;
            inner.setProperties({ positionTop: -initialOffset });
        } else {
            // Fine to run through the live-measured clamp here — an already-open menu's layout
            // has long since settled by the time it rerenders for an unrelated reason.
            applyOffset(startOffset);
        }

        // Disables every other interactive element while a real drag is in progress (the ray
        // cursor could otherwise hover/click things behind this popover). pointerEvents is
        // inherited, so flipping it at the panel root cascades everywhere except .option-menu
        // itself (explicit override in play.uikitml). Only toggled once a drag is confirmed, not
        // on plain pressed — pointerEvents is re-checked live on each raycast, so flipping it
        // before a tap's matching pointerup could change what object the release resolves to.
        const setOtherInteractorsEnabled = (enabled: boolean): void => {
            doc.rootElement.setProperties({ pointerEvents: enabled ? 'auto' : 'none' });
        };

        menu.setProperties({
            onPointerDown: (e: WorldPointerEvent) => {
                if (!e.point) return;
                const local = menu.worldToLocal(e.point.clone());
                pressed = true;
                dragging = false;
                startLocalY = local.y;
                startOffset = this.scrollOffset;
            },
            onPointerMove: (e: WorldPointerEvent) => {
                if (!pressed || !e.point) return;
                const local = menu.worldToLocal(e.point.clone());
                const deltaNorm = local.y - startLocalY;
                if (!dragging) {
                    if (Math.abs(deltaNorm) < DRAG_THRESHOLD) return;
                    dragging = true;
                    e.currentTarget?.setPointerCapture?.(e.pointerId);
                    setOtherInteractorsEnabled(false);
                }
                const menuSize = menu.size.peek();
                const deltaUnits = deltaNorm * (menuSize?.[1] ?? 0);
                applyOffset(startOffset + deltaUnits);
            },
            onPointerUp: (e: WorldPointerEvent) => {
                if (dragging) {
                    e.currentTarget?.releasePointerCapture?.(e.pointerId);
                    setOtherInteractorsEnabled(true);
                }
                pressed = false;
                dragging = false;
            },
            onPointerCancel: (e: WorldPointerEvent) => {
                if (dragging) {
                    e.currentTarget?.releasePointerCapture?.(e.pointerId);
                    setOtherInteractorsEnabled(true);
                }
                pressed = false;
                dragging = false;
            },
        });
    }
}
