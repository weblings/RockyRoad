import { iwsdkDev } from "@iwsdk/vite-plugin-dev";
import { compileUIKit } from "@iwsdk/vite-plugin-uikitml";
import { defineConfig } from "vite";
import mkcert from "vite-plugin-mkcert";

export default defineConfig({
  plugins: [
    mkcert(),
    iwsdkDev({
      emulator: {
        device: "metaQuest3",
      },
      ai: { tools: ["claude", "cursor", "copilot", "codex"] },
      verbose: true,
    }),

    compileUIKit({ sourceDir: "ui", outputDir: "public/ui", verbose: true }),
  ],
  server: {
    host: "0.0.0.0",
    port: 8081,
    open: true,
    fs: {
      allow: [
        ".",
        "D:/Users/Andrew/Documents/Coding/MusicThing/dlc",
        "D:/Users/Andrew/Documents/Coding/MusicThing/ChartPlayer/ChartPlayerShared",
        "D:/Users/Andrew/Documents/Coding/MusicThing/ChartPlayer/ThreeCP/Project/public",
      ],
    },
  },
  build: {
    outDir: "dist",
    sourcemap: process.env.NODE_ENV !== "production",
    target: "esnext",
    rollupOptions: { input: "./index.html" },
  },
  esbuild: { target: "esnext" },
  optimizeDeps: {
    exclude: ["@babylonjs/havok"],
    esbuildOptions: { target: "esnext" },
  },
  publicDir: "public",
  base: "./",
});
