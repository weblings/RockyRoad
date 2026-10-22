// Dev-only Vite plugin: lets the headset POST logs and audio back to the PC.
//   POST /__debug/log?session=<id>             body: JSON lines, appended to .debug/<id>.jsonl
//   POST /__debug/audio?session=<id>&name=<n>&rate=<hz>   body: Int16 mono PCM, saved as .debug/<id>-<n>.wav
import type { Plugin } from "vite";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const safe = (s: string | null, fallback: string) => (s ?? fallback).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60) || fallback;

function wavHeader(byteLen: number, rate: number): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + byteLen, 4); h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(byteLen, 40);
  return h;
}

export function debugLogPlugin(dir: string): Plugin {
  return {
    name: "rockyroad-debug-log",
    apply: "serve",
    configureServer(server) {
      mkdirSync(dir, { recursive: true });
      server.middlewares.use("/__debug", (req, res) => {
        if (req.method !== "POST") { res.statusCode = 405; res.end(); return; }
        const url = new URL(req.url ?? "/", "http://x");
        const session = safe(url.searchParams.get("session"), "session");
        const chunks: Buffer[] = [];
        req.on("data", c => chunks.push(c));
        req.on("end", () => {
          const body = Buffer.concat(chunks);
          try {
            if (url.pathname === "/log") {
              appendFileSync(join(dir, `${session}.jsonl`), body.toString("utf8").replace(/\n?$/, "\n"));
            } else if (url.pathname === "/audio") {
              const name = safe(url.searchParams.get("name"), "audio");
              const rate = Number(url.searchParams.get("rate")) || 48000;
              writeFileSync(join(dir, `${session}-${name}.wav`), Buffer.concat([wavHeader(body.length, rate), body]));
            } else { res.statusCode = 404; res.end(); return; }
            console.log(`[debug] ${url.pathname} ${session} ${body.length} bytes`);
            res.end("ok");
          } catch (e) {
            res.statusCode = 500; res.end(String(e));
          }
        });
      });
    },
  };
}
