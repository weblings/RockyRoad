// Writes one fade-out line PNG per string color for the XR tuner (uikit can't tint images).
// Run: npx tsx tools/gen-tuner-fade.ts
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { STRING_COLORS, stringColorCss } from "../src/shared/StringColors";

const W = 4, H = 128;
const FADE_END = 0.85;

const crcTable = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});
const crc = (b: Buffer): number => {
    let c = ~0;
    for (const v of b) c = crcTable[(c ^ v) & 255] ^ (c >>> 8);
    return ~c >>> 0;
};
function chunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
}

function png(r: number, g: number, b: number): Buffer {
    const raw = Buffer.alloc((W * 4 + 1) * H);
    for (let y = 0; y < H; y++) {
        const a = Math.max(0, 1 - y / (H - 1) / FADE_END);
        const row = y * (W * 4 + 1);
        for (let x = 0; x < W; x++) {
            const p = row + 1 + x * 4;
            raw[p] = r; raw[p + 1] = g; raw[p + 2] = b; raw[p + 3] = Math.round(a * 255);
        }
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
    ]);
}

const hexes = new Set<string>(["#ffffff"]);
for (let i = 0; i < STRING_COLORS.length; i++) {
    const hex = stringColorCss(i - 1);
    if (hex) hexes.add(hex);
}
for (const hex of hexes) {
    const n = parseInt(hex.slice(1), 16);
    writeFileSync(`public/tuner-fade-${hex.slice(1)}.png`, png(n >> 16, (n >> 8) & 255, n & 255));
}
console.log([...hexes].join(" "));
