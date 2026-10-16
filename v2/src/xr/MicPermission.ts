// Page step before Enter XR. Quest shows the mic prompt outside the immersive session, where the
// user can't see it, so on a VR-capable device we ask on the page while it is still visible.

async function needsMicPrompt(): Promise<boolean> {
    try {
        if (!(await navigator.xr?.isSessionSupported('immersive-ar'))) return false;
        const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        return status.state === 'prompt';
    } catch {
        return false;
    }
}

export async function offerMicPermission(): Promise<void> {
    if (!(await needsMicPrompt())) return;

    const bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:10;'
        + 'display:flex;gap:12px;align-items:center;padding:10px 14px;border-radius:8px;'
        + 'background:#1a1a1a;color:#fff;font:14px system-ui,sans-serif;';
    const text = document.createElement('span');
    text.textContent = 'The tuner needs your microphone. Allow it here, before entering VR.';
    const button = document.createElement('button');
    button.textContent = 'Allow microphone';
    button.style.cssText = 'padding:8px 14px;border:0;border-radius:6px;background:#dadada;color:#111;font:inherit;cursor:pointer;';
    bar.append(text, button);
    document.body.append(bar);

    button.addEventListener('click', async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(t => t.stop());
            bar.remove();
        } catch {
            text.textContent = 'Microphone blocked. Allow it in the browser site settings to use the tuner.';
            button.remove();
        }
    });
}
