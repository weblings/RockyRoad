import { iwsdkDev } from "@iwsdk/vite-plugin-dev";
import { compileUIKit } from "@iwsdk/vite-plugin-uikitml";
import { defineConfig } from "vite";
import mkcert from "vite-plugin-mkcert";

export default defineConfig(({ mode }) => {
  // `npm run dev:device` passes --mode device, which skips IWER injection so
  // the real Quest Link OpenXR runtime receives the WebXR session request.
  const deviceMode = mode === "device";

  return {
    plugins: [
      mkcert(),
      ...(deviceMode ? [] : [
        iwsdkDev({
          emulator: { device: "metaQuest3" },
          ai: { tools: ["claude", "cursor", "copilot", "codex"] },
          verbose: true,
        }),
      ]),
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
      sourcemap: mode !== "production",
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
  };
});
