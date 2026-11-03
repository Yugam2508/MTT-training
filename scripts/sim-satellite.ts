/**
 * Satellite research runner: plays the SPC 1B satellite headless with each hero policy and reports
 * how often it wins a seat.
 *
 *   npx tsx scripts/sim-satellite.ts --runs 2000 --start beginning --policies chipNash,fieldReg,seatEV
 *
 * Every policy plays the same seeds (same fields, same opening deals), and the work is split over
 * one process per CPU. Results go to research/satellite-<start>[-<tag>].json and a summary is printed.
 */
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { POLICIES } from '../src/research/registry';
import { runSatellite, satelliteConfig, summarize, type SimRun } from '../src/research/sim';

const args = new Map<string, string>();
for (let k = 2; k < process.argv.length; k += 2) args.set(process.argv[k].replace(/^--/, ''), process.argv[k + 1] ?? '');
const start = (args.get('start') ?? 'beginning') as 'beginning' | 'bubble';
const runs = Number(args.get('runs') ?? 400);
const first = Number(args.get('seed') ?? 1);
// --icm <0..1>: opponents fitted to real players, with this much bubble awareness
const field = args.has('icm') ? { icmAware: Number(args.get('icm')) } : undefined;
const tag = args.get('tag') ? `-${args.get('tag')}` : '';
const policies = (args.get('policies') ?? Object.keys(POLICIES).join(',')).split(',');

if (args.has('worker')) {
  // worker: one policy over a slice of seeds, one JSON line per run
  const policy = POLICIES[args.get('worker')!];
  const [a, b] = args.get('seeds')!.split('-').map(Number);
  for (let seed = a; seed <= b; seed++) process.stdout.write(JSON.stringify(runSatellite(policy, satelliteConfig(start, seed), field)) + '\n');
} else {
  await main();
}

function traceSummary(runs: SimRun[]) {
  const n = runs.length;
  const median = (xs: number[]) => { const a = xs.slice().sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 0; };
  const reach = Object.fromEntries((['50', '30', '20'] as const).map((k) => {
    const xs = runs.map((r) => r.trace?.reach[k]).filter((x): x is number => x !== undefined);
    return [k, { share: xs.length / n, median: median(xs) }];
  })) as Record<'50' | '30' | '20', { share: number; median: number }>;
  const at20 = runs.filter((r) => r.trace?.reach['20'] !== undefined);
  const v = runs.reduce((a, r) => a.map((x, i) => x + (r.trace?.vpip[i] ?? 0)), [0, 0, 0]);
  const chips: Record<string, number> = {};
  for (const r of runs) for (const [k, x] of Object.entries(r.trace?.chips ?? {})) chips[k] = (chips[k] ?? 0) + x / n;
  const busts: Record<string, number> = {};
  for (const r of runs) {
    const b = r.trace?.bust;
    if (!b) continue;
    const band = b.left > 50 ? '>50' : b.left > 20 ? '21-50' : '<=20';
    const key = `${band}:${b.role}`;
    busts[key] = (busts[key] ?? 0) + 1 / n;
  }
  return { reach, seatGiven20: at20.filter((r) => r.seat).length / Math.max(1, at20.length), vpip: (100 * v[1]) / Math.max(1, v[0]), pfr: (100 * v[2]) / Math.max(1, v[0]), chips, busts: Object.fromEntries(Object.entries(busts).sort()) };
}

function work(policy: string, a: number, b: number, onRun: () => void): Promise<SimRun[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), '--worker', policy, '--seeds', `${a}-${b}`, '--start', start, ...(field ? ['--icm', String(field.icmAware)] : [])], { stdio: ['ignore', 'pipe', 'inherit'] });
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
  console.log(`\nSPC 1B satellite (${start === 'bubble' ? 'from the bubble, 15 left' : 'full, 100 runners'}), ${runs} runs per policy, seeds ${first}-${first + runs - 1}${field ? `, data-fitted field, ICM awareness ${field.icmAware}` : ''}\n`);
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
  const traces = Object.fromEntries(policies.map((p) => [p, traceSummary(results[p])]));
  if (start === 'beginning') {
    console.log('\nwhere it goes (full satellites): reach = share of runs alive at N left, with median stack (bb); seat|20 = seat rate once 20 are left');
    console.log('policy            reach50        reach30        reach20      seat|20  vpip/pfr   chips before 20 left, bb per run: blinds steal preflop allinPre postflop');
    for (const p of policies) {
      const x = traces[p];
      const r = (n: '50' | '30' | '20') => `${pct(x.reach[n].share).padStart(6)} @${x.reach[n].median.toFixed(0).padStart(3)}bb`;
      console.log(`${p.padEnd(16)} ${r('50')}  ${r('30')}  ${r('20')}  ${pct(x.seatGiven20).padStart(6)}  ${x.vpip.toFixed(0)}/${x.pfr.toFixed(0)}`.padEnd(98) + (['blinds', 'steal', 'preflop', 'allinPre', 'postflop'] as const).map((k) => x.chips[k].toFixed(1).padStart(7)).join(''));
    }
    console.log('busts (share of runs): by players left when busting, and how the last chips went in');
    for (const p of policies) console.log(`${p.padEnd(16)} ${Object.entries(traces[p].busts).map(([k, v]) => `${k} ${pct(v as number)}`).join('  ')}`);
  }
  mkdirSync('research', { recursive: true });
  writeFileSync(`research/satellite-${start}${tag}.json`, JSON.stringify({ start, runs, field, firstSeed: first, summaries, paired, traces, ms: Date.now() - t0 }, null, 1));
}
