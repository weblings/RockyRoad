export async function micPermissionState(): Promise<PermissionState | null> {
    try {
        return (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state;
    } catch {
        return null;
    }
}

const TOAST_POLL_MS = 1000;
const BLOCKED_STEPS = ['... (top right) > Settings > Privacy and Security > Website Permissions > Microphone', 'Remove this site from Not Allowed'];

// Page toast shown after leaving VR with the site's mic denied, since only Browser settings can fix it.
// Follows the permission state: blocked text, then an Allow button once unblocked, then a confirmation.
export function showMicSiteBlockedToast(): void {
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;bottom:12px;left:50%;transform:translateX(-50%);z-index:10;max-width:90vw;'
        + 'display:flex;gap:12px;align-items:center;padding:10px 14px;border-radius:8px;background:#1a1a1a;color:#fff;font:14px system-ui,sans-serif;';
    const text = document.createElement('div');
    const button = document.createElement('button');
    button.textContent = 'Allow Mic';
    button.style.cssText = 'padding:8px 14px;border:0;border-radius:6px;background:#dadada;color:#111;font:inherit;cursor:pointer;';
    toast.append(text, button);
    document.body.append(toast);

    let done = false;
    const finish = () => {
        text.textContent = 'Re-enter VR';
        button.remove();
        done = true;
        setTimeout(() => toast.remove(), 4000);
    };
    const show = (state: PermissionState | null) => {
        const askable = state === 'prompt';
        button.style.display = askable ? '' : 'none';
        if (askable) { text.textContent = 'Site unblocked. Tap Allow Mic, then re-enter VR.'; return; }
        const title = document.createElement('div');
        title.textContent = 'Mic blocked for this site';
        title.style.fontWeight = '600';
        const note = document.createElement('div');
        note.textContent = '(In Browser app, not Settings):';
        const list = document.createElement('ol');
        list.style.cssText = 'margin:4px 0 0;padding-left:20px;';
        BLOCKED_STEPS.forEach(step => { const li = document.createElement('li'); li.textContent = step; list.append(li); });
        text.replaceChildren(title, note, list);
    };
    // Called from the click so Browser raises its real prompt on the flat page.
    button.addEventListener('click', () => {
        navigator.mediaDevices.getUserMedia({ audio: true })
            .then(stream => { stream.getTracks().forEach(t => t.stop()); finish(); })
            .catch(() => {});
    });
    const poll = async () => {
        if (done) return;
        const state = await micPermissionState();
        if (done) return;
        if (state === 'granted') { finish(); return; }
        show(state);
        setTimeout(poll, TOAST_POLL_MS);
    };
    void poll();
}
