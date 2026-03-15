import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const xmlPath = resolve(__dirname, "../../../ChartPlayerShared/Content/Textures/ImageManifest.xml");
const outPath = resolve(__dirname, "../public/ImageManifest.json");

const xml = readFileSync(xmlPath, "utf-8");

function extractText(tag: string, src: string): string {
    const m = src.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
    return m ? m[1] : "";
}

function extractAll(tag: string, src: string): string[] {
    const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g");
    const results: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) results.push(m[1]);
    return results;
}

interface SheetEntry {
    sheetName: string;
    sheetWidth: number;
    sheetHeight: number;
    images: {
        name: string;
        xOffset: number;
        yOffset: number;
        width: number;
        height: number;
    }[];
}

const sheets: SheetEntry[] = [];

for (const sheetXml of extractAll("ImageManifestSheet", xml)) {
    const sheetName = extractText("SheetName", sheetXml);
    const sheetWidth = parseInt(extractText("SheetWidth", sheetXml));
    const sheetHeight = parseInt(extractText("SheetHeight", sheetXml));
    const images = extractAll("ImageManifestSheetImage", sheetXml).map((imgXml) => ({
        name: extractText("ImageName", imgXml),
        xOffset: parseInt(extractText("XOffset", imgXml)),
        yOffset: parseInt(extractText("YOffset", imgXml)),
        width: parseInt(extractText("Width", imgXml)),
        height: parseInt(extractText("Height", imgXml)),
    }));
    sheets.push({ sheetName, sheetWidth, sheetHeight, images });
}

writeFileSync(outPath, JSON.stringify({ sheets }, null, 2), "utf-8");

const totalImages = sheets.reduce((n, s) => n + s.images.length, 0);
console.log(`Baked ${sheets.length} sheet(s), ${totalImages} image(s) → ${outPath}`);
