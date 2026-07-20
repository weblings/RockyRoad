export interface UIImage {
    xOffset: number;
    yOffset: number;
    width: number;
    height: number;
    actualWidth: number;
    actualHeight: number;
}

const registry = new Map<string, UIImage>();

interface ManifestImage {
    name: string;
    xOffset: number;
    yOffset: number;
    width: number;
    height: number;
}

interface ManifestSheet {
    sheetName: string;
    sheetWidth: number;
    sheetHeight: number;
    images: ManifestImage[];
}

interface Manifest {
    sheets: ManifestSheet[];
}

export async function loadManifest(url: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
    const manifest: Manifest = await response.json();

    registry.clear();

    for (const sheet of manifest.sheets) {
        for (const img of sheet.images) {
            registry.set(img.name, {
                xOffset: img.xOffset,
                yOffset: img.yOffset,
                width: img.width,
                height: img.height,
                actualWidth: sheet.sheetWidth,
                actualHeight: sheet.sheetHeight,
            });
        }
    }
}

export function getImage(name: string): UIImage {
    const image = registry.get(name);
    if (!image) throw new Error(`UIImage not found: "${name}"`);
    return image;
}
