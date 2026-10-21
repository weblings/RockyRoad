// Custom trigger+menu dropdown for desktop screens — DOM/CSS counterpart to XR's
// src/xr/OptionDropdown.ts, generalized from Library's original Sort control. One instance per
// dropdown; caller supplies the option list and trigger label, this owns open/closed state and
// the menu's DOM.

export interface DropdownOption {
    label: string;
    value: string;
    selected: boolean;
}

export class Dropdown {
    // Backs the outside-click/sibling-close listener below — every instance registers here.
    private static instances: Dropdown[] = [];
    private static outsideClickListenerInstalled = false;

    readonly root: HTMLElement;
    private readonly trigger: HTMLButtonElement;
    private readonly labelEl: HTMLElement;
    private readonly menu: HTMLElement;
    private readonly chevronDown: HTMLImageElement;
    private readonly chevronUp: HTMLImageElement;
    private _open = false;

    constructor(container: HTMLElement, initialLabel: string, onSelect: (value: string) => void) {
        this.root = document.createElement('div');
        this.root.className = 'dropdown';

        this.trigger = document.createElement('button');
        this.trigger.type = 'button';
        this.trigger.className = 'dropdown-trigger';

        this.labelEl = document.createElement('span');
        this.labelEl.className = 'dropdown-label';
        this.labelEl.textContent = initialLabel;

        // Two swapped SVGs, not a single rotated glyph — same assets/approach as XR's
        // .option-chevron (ui/play.uikitml, ui/song.uikitml).
        this.chevronDown = document.createElement('img');
        this.chevronDown.className = 'dropdown-chevron';
        this.chevronDown.src = `${import.meta.env.BASE_URL}chevron-down.svg`;
        this.chevronDown.alt = '';

        this.chevronUp = document.createElement('img');
        this.chevronUp.className = 'dropdown-chevron';
        this.chevronUp.src = `${import.meta.env.BASE_URL}chevron-up.svg`;
        this.chevronUp.alt = '';
        this.chevronUp.style.display = 'none';

        this.trigger.append(this.labelEl, this.chevronDown, this.chevronUp);

        this.menu = document.createElement('div');
        this.menu.className = 'dropdown-menu';

        this.root.append(this.trigger, this.menu);
        container.appendChild(this.root);

        // No stopPropagation — letting this bubble to the document-level listener installed
        // below is what makes opening one dropdown close any other that's already open, for
        // free. See that listener's own comment for the full reasoning.
        this.trigger.addEventListener('click', () => {
            this.toggle();
        });

        this.menu.addEventListener('click', (e) => {
            const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.dropdown-option');
            if (!btn) return;
            this.close();
            onSelect(btn.dataset.value!);
        });

        Dropdown.instances.push(this);
        Dropdown.ensureOutsideClickListener();
    }

    // Installed once, lazily, on first Dropdown construction — never removed, since it's a
    // single stateless global listener regardless of how many instances come and go.
    //
    // Bubble phase (default), not capture, is required: a trigger's own click handler (attached
    // directly to the trigger, so it always runs first) has already toggled that dropdown's open
    // state by the time this listener sees the same event on its way up to document. So for
    // "dropdown A open, click dropdown B's trigger": B is already open with the click target
    // inside its own root by the time this runs (stays open); A is open with the click target
    // outside its root (closes). The same containment check also covers genuine outside clicks
    // (anywhere that isn't part of any dropdown) — one mechanism, not two.
    private static ensureOutsideClickListener(): void {
        if (Dropdown.outsideClickListenerInstalled) return;
        Dropdown.outsideClickListenerInstalled = true;
        document.addEventListener('click', (e) => {
            if (!(e.target instanceof Node)) return;
            for (const dropdown of Dropdown.instances) {
                if (dropdown.isOpen && !dropdown.root.contains(e.target)) dropdown.close();
            }
        });
    }

    get isOpen(): boolean {
        return this._open;
    }

    toggle(): void {
        if (this._open) this.close(); else this.openMenu();
    }

    openMenu(): void {
        this._open = true;
        this.root.classList.add('open');
        this.chevronDown.style.display = 'none';
        this.chevronUp.style.display = '';
    }

    close(): void {
        this._open = false;
        this.root.classList.remove('open');
        this.chevronDown.style.display = '';
        this.chevronUp.style.display = 'none';
    }

    setTriggerLabel(text: string): void {
        this.labelEl.textContent = text;
    }

    // Closes the menu too if hiding — a hidden-but-still-open dropdown would otherwise pop back
    // open with no trigger click the next time it's shown.
    setVisible(visible: boolean): void {
        if (!visible) this.close();
        this.root.style.display = visible ? '' : 'none';
    }

    // Full destroy+recreate of the option list on every call — same "destroy and recreate"
    // pattern XR's OptionDropdown.renderDynamic() uses, no diffing needed at this list size.
    setOptions(options: DropdownOption[]): void {
        this.menu.innerHTML = '';
        for (const opt of options) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'dropdown-option' + (opt.selected ? ' selected' : '');
            btn.textContent = opt.label;
            btn.dataset.value = opt.value;
            this.menu.appendChild(btn);
        }
    }

    // Call before discarding an instance (e.g. before a full-container innerHTML rebuild) so it
    // doesn't linger in the static registry.
    destroy(): void {
        Dropdown.instances = Dropdown.instances.filter(d => d !== this);
        this.root.remove();
    }
}
