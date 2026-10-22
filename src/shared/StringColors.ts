import { makeColor, type UIColor } from "./UIColor";

// 7 colors cycling for string assignment. The fretboard and the tuner both read string i from
// index i + STRING_COLOR_OFFSET (offset=1 for standard guitar/bass), so they always agree.
export const STRING_COLOR_OFFSET = 1;
export const STRING_COLORS: UIColor[] = [
    makeColor(0.1, 0.8, 0),        // Green
    makeColor(1, 0, 0),            // Red
    makeColor(1, 1, 0),            // Yellow
    makeColor(0, 0.6, 1),          // Cyan
    makeColor(1, 0.647, 0),        // Orange
    makeColor(0.1, 0.8, 0),        // Green (second)
    makeColor(0.8, 0, 0.8),        // Purple
];
export const STRING_COLOR_NAMES = ["Green", "Red", "Yellow", "Cyan", "Orange", "Green", "Purple"];

export function stringColor(str: number): UIColor {
    return STRING_COLORS[str + STRING_COLOR_OFFSET];
}

// CSS hex for 2D canvas drawing, undefined past the palette.
export function stringColorCss(str: number): string | undefined {
    const c = stringColor(str);
    if (!c) return undefined;
    const h = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
    return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}
