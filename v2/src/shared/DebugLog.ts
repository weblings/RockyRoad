// Dev-only channel to the PC (see tools/debugLogPlugin.ts). No-ops in production builds.
// Files land in v2/.debug/<session>.jsonl and <session>-<name>.wav.

const ENABLED = import.meta.env.DEV;
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

// Queues one JSON line and sends the batch about once a second.
export function debugLog(event: string, data: Record<string, unknown> = {}): void {
    if (!ENABLED) return;
    queue.push(JSON.stringify({ t: Math.round(performance.now()), event, ...data }));
    if (!timer) timer = setTimeout(flush, FLUSH_MS);
}

export function debugAudio(name: string, pcm: Int16Array, rate: number): void {
    if (!ENABLED) return;
    flush();
    fetch(`/__debug/audio?session=${SESSION}&name=${encodeURIComponent(name)}&rate=${rate}`, {
        method: 'POST', body: pcm.buffer as ArrayBuffer,
    }).then(r => debugLog('audio-sent', { name, ok: r.ok, samples: pcm.length }))
      .catch(e => debugLog('audio-failed', { name, error: String(e) }));
}

export const debugEnabled = ENABLED;
