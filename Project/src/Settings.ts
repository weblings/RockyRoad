// Persistent user settings — stored as a single JSON blob in localStorage.
// All screens that read or write settings import loadSettings / saveSettings.

const SETTINGS_KEY = 'chartplayer-settings';

export interface Settings {
    skipIntro: boolean;     // seek to first note on song load
    boldText: boolean;      // high-contrast #E8E8E8 labels (default on)
    invertStrings: boolean; // flip string order vertically
    leftyMode: boolean;     // mirror the fretboard horizontally
}

const DEFAULTS: Settings = {
    skipIntro: false,
    boldText: true,
    invertStrings: false,
    leftyMode: false,
};

export function loadSettings(): Settings {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch { /* corrupt data — fall through to defaults */ }
    return { ...DEFAULTS };
}

export function saveSettings(s: Settings): void {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}
