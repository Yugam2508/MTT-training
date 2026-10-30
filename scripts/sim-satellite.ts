/**
 * Satellite research runner: plays the SPC 1B satellite headless with each hero policy and reports
 * how often it wins a seat.
 *
 *   npx tsx scripts/sim-satellite.ts --runs 2000 --start beginning --policies chipNash,fieldReg,seatEV
 *
 * Every policy plays the same seeds (same fields, same opening deals), and the work is split over
 * one process per CPU. Results go to research/satellite-<start>.json and a summary is printed.
 */
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { POLICIES } from '../src/research/policies';
import { runSatellite, satelliteConfig, summarize, type SimRun } from '../src/research/sim';

const args = new Map<string, string>();
for (let k = 2; k < process.argv.length; k += 2) args.set(process.argv[k].replace(/^--/, ''), process.argv[k + 1] ?? '');
const start = (args.get('start') ?? 'beginning') as 'beginning' | 'bubble';
const runs = Number(args.get('runs') ?? 400);
const first = Number(args.get('seed') ?? 1);
const policies = (args.get('policies') ?? Object.keys(POLICIES).join(',')).split(',');

if (args.has('worker')) {
  // worker: one policy over a slice of seeds, one JSON line per run
  const policy = POLICIES[args.get('worker')!];
  const [a, b] = args.get('seeds')!.split('-').map(Number);
  for (let seed = a; seed <= b; seed++) process.stdout.write(JSON.stringify(runSatellite(policy, satelliteConfig(start, seed))) + '\n');
} else {
  await main();
}

function work(policy: string, a: number, b: number, onRun: () => void): Promise<SimRun[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), '--worker', policy, '--seeds', `${a}-${b}`, '--start', start], { stdio: ['ignore', 'pipe', 'inherit'] });
    const out: SimRun[] = [];
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) { out.push(JSON.parse(buf.slice(0, nl))); buf = buf.slice(nl + 1); onRun(); }
    });
    child.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`worker exited ${code}`))));
  });
}

async function main() {
  const procs = Math.max(1, cpus().length);
  const results: Record<string, SimRun[]> = {};
  const t0 = Date.now();
  for (const p of policies) {
    if (!POLICIES[p]) throw new Error(`unknown policy ${p}`);
    let done = 0;
    const per = Math.ceil(runs / procs);
    const jobs = [];
    for (let w = 0; w < procs; w++) {
      const a = first + w * per, b = Math.min(first + runs - 1, a + per - 1);
      if (a <= b) jobs.push(work(p, a, b, () => { if (++done % 100 === 0) console.error(`${p}: ${done}/${runs} (${((Date.now() - t0) / 1000).toFixed(0)}s)`); }));
    }
    results[p] = (await Promise.all(jobs)).flat().sort((x, y) => x.seed - y.seed);
  }
  const summaries = policies.map((p) => summarize(p, results[p]));
  const pct = (x: number) => (x * 100).toFixed(1) + '%';
  console.log(`\nSPC 1B satellite (${start === 'bubble' ? 'from the bubble, 15 left' : 'full, 100 runners'}), ${runs} runs per policy, seeds ${first}-${first + runs - 1}\n`);
  console.log('policy      seat rate   ±95%    avg place  avg hands');
  for (const s of summaries) console.log(`${s.policy.padEnd(11)} ${pct(s.rate).padStart(9)}  ${pct(s.ci95).padStart(6)}  ${s.avgPlace.toFixed(1).padStart(9)}  ${s.avgHands.toFixed(1).padStart(9)}`);
  // paired differences: same seeds, so the shared luck cancels
  const base = policies[0];
  const paired: Record<string, { diff: number; ci95: number }> = {};
  for (const p of policies.slice(1)) {
    const d = results[p].map((r, k) => Number(r.seat) - Number(results[base][k].seat));
    const mean = d.reduce((a, b) => a + b, 0) / d.length;
    const sd = Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, d.length - 1));
    paired[p] = { diff: mean, ci95: (1.96 * sd) / Math.sqrt(d.length) };
    console.log(`${p} vs ${base}: ${mean >= 0 ? '+' : ''}${pct(mean)} seat rate (±${pct(paired[p].ci95)}, paired)`);
  }
  mkdirSync('research', { recursive: true });
  writeFileSync(`research/satellite-${start}.json`, JSON.stringify({ start, runs, firstSeed: first, summaries, paired, ms: Date.now() - t0 }, null, 1));
}
