export interface UIColor {
    r: number;
    g: number;
    b: number;
    a: number;
}

export function makeColor(r: number, g: number, b: number, a = 1): UIColor {
    return { r, g, b, a };
}

export function lerp(a: UIColor, b: UIColor, t: number): UIColor {
    return {
        r: a.r + (b.r - a.r) * t,
        g: a.g + (b.g - a.g) * t,
        b: a.b + (b.b - a.b) * t,
        a: a.a + (b.a - a.a) * t,
    };
}

export function multiplyScalar(c: UIColor, s: number): UIColor {
    return { r: c.r * s, g: c.g * s, b: c.b * s, a: c.a * s };
}

export function multiplyAlpha(c: UIColor, s: number): UIColor {
    return { r: c.r, g: c.g, b: c.b, a: c.a * s };
}

export const White       = makeColor(1, 1, 1);
export const Black       = makeColor(0, 0, 0);
export const Transparent = makeColor(0, 0, 0, 0);
export const Red         = makeColor(1, 0, 0);
export const Green       = makeColor(0, 1, 0);
export const Blue        = makeColor(0, 0, 1);
export const Yellow      = makeColor(1, 1, 0);
export const Cyan        = makeColor(0, 1, 1);
export const Magenta     = makeColor(1, 0, 1);
export const Orange      = makeColor(1, 0.5, 0);
export const Gray        = makeColor(0.5, 0.5, 0.5);
export const DarkGray    = makeColor(0.25, 0.25, 0.25);
export const LightGray   = makeColor(0.75, 0.75, 0.75);
