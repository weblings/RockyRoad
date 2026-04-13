// Persistent user settings — stored as a single JSON blob in localStorage.
// All screens that read or write settings import loadSettings / saveSettings.

const SETTINGS_KEY = 'chartplayer-settings';

export interface Settings {
    skipIntro: boolean;         // seek to first note on song load
    boldText: boolean;          // high-contrast #E8E8E8 labels (default on)
    invertStrings: boolean;     // flip string order vertically
    leftyMode: boolean;         // mirror the fretboard horizontally
    tunerAutoAdvance: boolean;  // auto-proceed after "In tune!" (default on)
    inputGain: number;          // mic gain multiplier 1–8 (default 1)
    fullKeyboard: boolean;      // keys: always show full 88-key range (default on)
    keysTopDown: boolean;       // keys: top-down piano-roll camera (default off)
    keysRightHandColor: string; // hex color for right-hand notes
    keysLeftHandColor: string;  // hex color for left-hand notes
}

const DEFAULTS: Settings = {
    skipIntro: false,
    boldText: true,
    invertStrings: false,
    leftyMode: false,
    tunerAutoAdvance: true,
    inputGain: 1,
    fullKeyboard: true,
    keysTopDown: false,
    keysRightHandColor: '#2E71D6',
    keysLeftHandColor: '#E33737',
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
