import { iwsdkDev }     from "@iwsdk/vite-plugin-dev";
import { compileUIKit } from "@iwsdk/vite-plugin-uikitml";
import { defineConfig, type Plugin } from "vite";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import mkcert           from "vite-plugin-mkcert";
import { debugLogPlugin } from "./tools/debugLogPlugin";

const { version } = JSON.parse(readFileSync("./package.json", "utf-8"));

// Drops song folders marked DevOnly in song.json from dist (public/ is copied wholesale).
function stripDevOnlySongs(): Plugin {
  return {
    name: "rockyroad-strip-dev-songs",
    apply: "build",
    closeBundle() {
      const root = "./dist/songs";
      for (const name of readdirSync(root, { withFileTypes: true })) {
        if (!name.isDirectory()) continue;
        try {
          const raw = JSON.parse(readFileSync(`${root}/${name.name}/song.json`, "utf-8"));
          if (raw.DevOnly === true) rmSync(`${root}/${name.name}`, { recursive: true, force: true });
        } catch { /* no song.json */ }
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const deviceMode = mode === "device";

  return {
    define: { __APP_VERSION__: JSON.stringify(version) },
    plugins: [
      mkcert(),
      stripDevOnlySongs(),
      debugLogPlugin("./.debug"),
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
      include: ["poly-peach/dist/chromagram", "@markusstrasser/pitchplease"],
      exclude: ["@babylonjs/havok"],
      esbuildOptions: { target: "esnext" },
    },
    publicDir: "public",
    base: "./",
  };
});
