import { iwsdkDev }     from "@iwsdk/vite-plugin-dev";
import { compileUIKit } from "@iwsdk/vite-plugin-uikitml";
import { defineConfig } from "vite";
import mkcert           from "vite-plugin-mkcert";

export default defineConfig(({ mode }) => {
  const deviceMode = mode === "device";

  return {
    plugins: [
      mkcert(),
      // IWSDK emulator: skip in device mode; harmless on desktop.html because
      // it only activates when World.create() is called, which desktop never does.
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
      open: "desktop.html",
      proxy: {
        // song-server running at http://localhost:3001 (plain HTTP, no TLS needed in dev).
        // Enter http://localhost:8081/remote-songs as the Library URL in the app.
        '/remote-songs': {
          target: 'http://localhost:3001',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/remote-songs/, ''),
        },
      },
      fs: {
        allow: [
          ".",
          "D:/Users/Andrew/Documents/Coding/MusicThing/dlc",
          "D:/Users/Andrew/Documents/Coding/MusicThing/ChartPlayer/ThreeCP/Project/public",
          "C:/Users/mewuz/Music/Charts",
        ],
      },
    },
    build: {
      outDir: "dist",
      sourcemap: mode !== "production",
      target: "esnext",
      rollupOptions: {
        input: {
          desktop: "desktop.html",
          xr:      "xr.html",
        },
      },
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
