import { defineConfig } from "vite";

export default defineConfig({
    server: {
        fs: {
            // Allow fetching song files from the DLC library via /@fs/ URLs
            allow: [
                ".",
                "D:/Users/Andrew/Documents/Coding/MusicThing/dlc",
            ],
        },
    },
});
