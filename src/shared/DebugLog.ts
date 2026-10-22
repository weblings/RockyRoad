// Dev-only channel to the PC (see tools/debugLogPlugin.ts). No-ops in production builds.
// Files land in .debug/<session>.jsonl and <session>-<name>.wav.

export type DebugFeature = 'tuner' | 'tuner-frames' | 'library' | 'console';

// Comma list from ?debug=a,b or VITE_DEBUG (put it in .env.local, no source edit to revert).
// 'tuner-frames' is the per-frame detector stream, kept apart from the lower-volume 'tuner' events.
// 'console' mirrors console output onto an in-scene plane (xr/index.ts), not the PC channel.
const DEBUG_FEATURES = (new URLSearchParams(location.search).get('debug') ?? import.meta.env.VITE_DEBUG ?? '')
    .split(',').map((s: string) => s.trim()).filter(Boolean);

const DEV = import.meta.env.DEV;
const SESSION = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const FLUSH_MS = 1000;

let queue: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function flush(): void {
    timer = null;
    if (queue.length === 0) return;
    const body = queue.join('\n');
    queue = [];
    fetch(`/__debug/log?session=${SESSION}`, { method: 'POST', body, keepalive: true }).catch(() => {});
}

export function debugOn(feature: DebugFeature): boolean {
    return DEV && DEBUG_FEATURES.includes(feature);
}

// Queues one JSON line and sends the batch about once a second.
export function debugLog(feature: DebugFeature, event: string, data: Record<string, unknown> = {}): void {
    if (!debugOn(feature)) return;
    queue.push(JSON.stringify({ t: Math.round(performance.now()), event, ...data }));
    if (!timer) timer = setTimeout(flush, FLUSH_MS);
}

export function debugAudio(feature: DebugFeature, name: string, pcm: Int16Array, rate: number): void {
    if (!debugOn(feature)) return;
    flush();
    fetch(`/__debug/audio?session=${SESSION}&name=${encodeURIComponent(name)}&rate=${rate}`, {
        method: 'POST', body: pcm.buffer as ArrayBuffer,
    }).then(r => debugLog(feature, 'audio-sent', { name, ok: r.ok, samples: pcm.length }))
      .catch(e => debugLog(feature, 'audio-failed', { name, error: String(e) }));
}
