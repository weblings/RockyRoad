/**
 * Scores a recorded detector run offline.
 * Record: ?input=polyphon&debug=polyphon-frames, play a Keys song, leave the screen.
 * Run:    npm run replay -- [file.jsonl] [--run=N] [--offset=SEC] [--tolerance=N] [--json] [pp.minProb=0.5 ...]
 * Without a file it uses the newest .debug log holding a run. pp.* are the same names as the URL params,
 * but only minProb, retrigger and gate apply (model and on/off act inside the detector).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseRuns } from '../src/shared/FrameRecording';
import { formatResult, replayRun, type ReplayOverrides } from '../src/shared/FrameReplay';
import { polyphonConfigFromParams } from '../src/shared/PolyphonConfig';

const args = process.argv.slice(2);
const flag = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const file = args.find(a => !a.startsWith('--') && !a.startsWith('pp.'));

function newestLogWithRuns(): string {
    const dir = resolve('.debug');
    const files = readdirSync(dir).filter(f => f.endsWith('.jsonl'))
        .map(f => join(dir, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    const hit = files.find(f => readFileSync(f, 'utf8').includes('"event":"run-start"'));
    if (!hit) throw new Error('No .debug log with a recorded run. Use ?debug=polyphon-frames.');
    return hit;
}

const path = file ? resolve(file) : newestLogWithRuns();
const runs = parseRuns(readFileSync(path, 'utf8'));
if (!runs.length) throw new Error(`No run in ${path}`);
const idx = flag('run') !== undefined ? Number(flag('run')) : runs.length - 1;
const run = runs[idx];
if (!run) throw new Error(`Run ${idx} not found, file has ${runs.length}`);

const over: ReplayOverrides = {};
const pp = args.filter(a => a.startsWith('pp.'));
if (pp.length) {
    const c = polyphonConfigFromParams(new URLSearchParams(pp.join('&')), run.config);
    over.config = { minProb: c.minProb, retriggerRise: c.retriggerRise, gateWindow: c.gateWindow };
}
if (flag('offset') !== undefined) over.devOffset = Number(flag('offset'));
if (flag('tolerance') !== undefined) over.scorer = { tolerance: Number(flag('tolerance')) };

const result = replayRun(run, over);
if (Object.keys(over).length) result.matchesLive = null; // overrides are expected to differ
if (args.includes('--json')) console.log(JSON.stringify(result));
else {
    console.log(`${path}  run ${idx + 1}/${runs.length}  ${run.events.length} events`);
    console.log(formatResult(result));
}
