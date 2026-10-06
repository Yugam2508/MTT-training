/**
 * Multi-table tournament manager. The hero's table is played action by action; every other
 * table plays one hand instantly per hero hand (hand-for-hand), so eliminations, table moves,
 * the bubble and the final table happen at realistic moments.
 */
import { type HandState, type PlayerAction, type SeatInput, type HandConfig, createHand, applyAction, toMove } from '../engine/hand';
import { fullDeck, type Card } from '../engine/cards';
import { makeRng, shuffleInPlace, type Rng } from '../engine/rng';
import { PROFILES, FIELD_MIXES, type ProfileKey } from '../bots/profiles';
import { chooseBotAction } from '../bots/bot';
import { icmBatch } from '../theory/icm';
import { payoutStructure, paidPlaces, satellitePayouts } from '../theory/payouts';
import { positionOf } from '../theory/spot';
import { POS_LABEL } from '../theory/positions';
import { computeFlags, accumulate, emptyCounts, type HandFlags, type StatCounts } from '../analysis/handFlags';
import { blindLevel, levelForDepth, stageOf, type Level, type Stage, type TournamentConfig } from './structure';
import { makeNames } from './names';
import { levelMinutes, BREAK_EVERY_LEVELS, BREAK_MINUTES } from './pace';

export interface TPlayer {
  id: string;
  name: string;
  profile: ProfileKey | 'hero';
  stack: number;
  tableId: number;
  seat: number;
  busted: boolean;
  place: number;
  prize: number;
  isHero: boolean;
}

export interface TTable {
  id: number;
  seats: (string | null)[];
  button: number;
}

export interface SeatInfo extends SeatInput {
  profile: ProfileKey | 'hero';
  pos: string;
}

export interface HandRecord {
  id: string;
  tid: string;
  handNo: number;
  ts: number;
  level: number;
  cfg: HandConfig;
  button: number;
  seats: SeatInfo[];
  deck: Card[];
  moves: PlayerAction[];
  heroIndex: number;
  tableId: number;
  playersLeft: number;
  paid: number;
  entrants: number;
  stage: Stage;
  avgStackBB: number;
  heroStartBB: number;
  heroNet: number;
  heroNetBB: number;
  flags: HandFlags;
}

export interface TEvent {
  handNo: number;
  kind: 'level' | 'move' | 'break' | 'final' | 'bubble' | 'bust' | 'itm' | 'info' | 'win';
  text: string;
}

export interface TournamentResult {
  id: string;
  ts: number;
  name: string;
  entrants: number;
  buyIn: number;
  place: number;
  prize: number;
  handsPlayed: number;
  stageReached: Stage;
  start: TournamentConfig['start'];
  field: TournamentConfig['field'];
  currency?: string;
  /** Satellite result: true when the hero won a seat. */
  seat?: boolean;
}

export const HERO_ID = 'hero';

function prizesFor(cfg: TournamentConfig): number[] {
  const sat = cfg.satellite;
  if (sat) return satellitePayouts(cfg.entrants, cfg.buyIn - (cfg.fee ?? 0), sat.seatValue, sat.guaranteedSeats);
  return payoutStructure(cfg.entrants, cfg.buyIn - (cfg.fee ?? 0), cfg.paid);
}

/** Places paid. In a satellite this is the number of seats; a leftover cash prize is not counted. */
function paidFor(cfg: TournamentConfig, prizes: number[]): number {
  const sat = cfg.satellite;
  return sat ? prizes.filter((x) => x === sat.seatValue).length : cfg.paid ?? paidPlaces(cfg.entrants);
}

export interface TournamentSnapshot {
  v: 1;
  id: string;
  cfg: TournamentConfig;
  players: TPlayer[];
  tables: TTable[];
  levelIndex: number;
  roundsAtLevel: number;
  handNo: number;
  heroHands: number;
  rng: number;
  current: HandState | null;
  currentTableId: number | null;
  currentSeatIds: string[];
  events: TEvent[];
  hud: [string, StatCounts][];
  bf: [string, number][];
  finished: boolean;
  heroOut: boolean;
  bubbleBurst: boolean;
  stageReached: Stage;
  roundStartStacks: [string, number][];
  finalTableAnnounced: boolean;
  stackTrail: number[];
  levelElapsedMs?: number;
  breakLeftMs?: number;
  levelsSinceBreak?: number;
  playedMs?: number;
}

export class Tournament {
  readonly id: string;
  readonly cfg: TournamentConfig;
  readonly prizes: number[];
  readonly paid: number;
  players = new Map<string, TPlayer>();
  tables: TTable[] = [];
  levelIndex = 0;
  roundsAtLevel = 0;
  handNo = 0;
  heroHands = 0;
  rng: Rng;
  current: HandState | null = null;
  currentTable: TTable | null = null;
  currentSeatIds: string[] = [];
  events: TEvent[] = [];
  history: HandRecord[] = [];
  hud = new Map<string, StatCounts>();
  bf = new Map<string, number>();
  finished = false;
  heroOut = false;
  bubbleBurst = false;
  stageReached: Stage = 'early';
  /** Hero stack in big blinds at the start of each hand. */
  stackTrail: number[] = [];
  // Live pace clock (only used when cfg.pace === 'live'): time played at this level, break time left,
  // levels since the last break, and total play time.
  levelElapsedMs = 0;
  breakLeftMs = 0;
  levelsSinceBreak = 0;
  playedMs = 0;
  private roundStartStacks = new Map<string, number>();
  private finalTableAnnounced = false;

  constructor(cfg: TournamentConfig, heroName = 'You') {
    this.cfg = cfg;
    this.id = `t${Date.now().toString(36)}${cfg.seed.toString(36).slice(0, 4)}`;
    this.rng = makeRng(cfg.seed);
    this.prizes = prizesFor(cfg);
    this.paid = paidFor(cfg, this.prizes);
    this.setupField(heroName);
    this.computeBubbleFactors();
  }

  // ---------- setup ----------

  private setupField(heroName: string) {
    const { entrants, tableSize, startingStack } = this.cfg;
    const names = makeNames(entrants - 1, this.rng);
    const mix = FIELD_MIXES[this.cfg.field].weights;
    const keys = Object.keys(mix) as ProfileKey[];
    const totalW = keys.reduce((a, k) => a + (mix[k] ?? 0), 0);
    const pickProfile = () => {
      let x = this.rng.next() * totalW;
      for (const k of keys) { x -= mix[k] ?? 0; if (x <= 0) return k; }
      return keys[0];
    };
    const ids: string[] = [HERO_ID];
    this.players.set(HERO_ID, { id: HERO_ID, name: heroName, profile: 'hero', stack: startingStack, tableId: -1, seat: -1, busted: false, place: 0, prize: 0, isHero: true });
    for (let k = 0; k < entrants - 1; k++) {
      const id = `p${k}`;
      ids.push(id);
      this.players.set(id, { id, name: names[k], profile: pickProfile(), stack: startingStack, tableId: -1, seat: -1, busted: false, place: 0, prize: 0, isHero: false });
    }
    // scenario starts: remove players and redistribute chips
    const totalChips = entrants * startingStack;
    let remaining = entrants;
    let targetBB = 0;
    if (this.cfg.start === 'middle') { remaining = Math.max(this.paid + 10, Math.round(entrants * 0.45)); targetBB = 35; }
    if (this.cfg.start === 'bubble') {
      // satellite bubbles are longer and shallower: everyone left is playing for the same seat
      if (this.cfg.satellite) { remaining = this.paid + Math.max(3, Math.round(this.paid * 0.5)); targetBB = 14; }
      else { remaining = this.paid + Math.max(2, Math.round(this.paid * 0.12)); targetBB = 24; }
    }
    if (this.cfg.start === 'final') { remaining = Math.min(tableSize, entrants); targetBB = 22; }
    if (remaining < entrants) {
      const others = shuffleInPlace(ids.slice(1), this.rng);
      const out = others.slice(0, entrants - remaining);
      out.forEach((id, k) => {
        const p = this.players.get(id)!;
        p.busted = true;
        p.stack = 0;
        p.place = entrants - k;
        p.prize = this.prizes[p.place - 1] ?? 0;
      });
      const alive = ids.filter((id) => !this.players.get(id)!.busted);
      const avg = totalChips / alive.length;
      // log-normal stack distribution
      const raw = alive.map(() => Math.exp(this.gauss() * 0.55));
      const heroMult: Record<string, number> = { short: 0.45, average: 1, big: 2.1 };
      if (this.cfg.heroStack !== 'random') raw[0] = heroMult[this.cfg.heroStack] * (raw.reduce((a, b) => a + b, 0) / raw.length);
      const sum = raw.reduce((a, b) => a + b, 0);
      alive.forEach((id, k) => { this.players.get(id)!.stack = Math.max(100, Math.round((raw[k] / sum) * totalChips / 100) * 100); });
      // fix rounding so chips are conserved
      const diff = totalChips - alive.reduce((a, id) => a + this.players.get(id)!.stack, 0);
      const biggest = alive.reduce((a, id) => (this.players.get(id)!.stack > this.players.get(a)!.stack ? id : a), alive[0]);
      this.players.get(biggest)!.stack += diff;
      this.levelIndex = levelForDepth(avg, targetBB);
    }
    // seat players
    const alive = shuffleInPlace(ids.filter((id) => !this.players.get(id)!.busted), this.rng);
    const nTables = Math.ceil(alive.length / tableSize);
    for (let t = 0; t < nTables; t++) this.tables.push({ id: t + 1, seats: new Array(tableSize).fill(null), button: this.rng.int(tableSize) });
    alive.forEach((id, k) => {
      const t = this.tables[k % nTables];
      const free = t.seats.map((s, i) => (s ? -1 : i)).filter((i) => i >= 0);
      const seat = free[this.rng.int(free.length)];
      t.seats[seat] = id;
      const p = this.players.get(id)!;
      p.tableId = t.id;
      p.seat = seat;
    });
    this.stageReached = this.stage();
    const sat = this.cfg.satellite;
    const paidText = sat ? `${this.paid} seats worth ${this.money(sat.seatValue, 0)} each` : `${this.paid} places paid`;
    this.pushEvent('info', `${this.cfg.name}: ${entrants} entrants, ${paidText}. Blinds ${this.fmtLevel(this.level())}.`);
  }

  private gauss() {
    const u = 1 - this.rng.next(), v = this.rng.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // ---------- queries ----------

  level(): Level { return blindLevel(this.levelIndex); }
  money(x: number, digits = 2) { return `${this.cfg.currency ?? '$'}${x.toFixed(digits)}`; }
  fmtLevel(l: Level) { return `${l.sb.toLocaleString()}/${l.bb.toLocaleString()} ante ${l.ante.toLocaleString()}`; }
  alive(): TPlayer[] { return [...this.players.values()].filter((p) => !p.busted); }
  playersLeft() { return this.alive().length; }
  hero(): TPlayer { return this.players.get(HERO_ID)!; }
  heroTable(): TTable | undefined { return this.tables.find((t) => t.seats.includes(HERO_ID)); }
  avgStack() { const a = this.alive(); return a.reduce((s, p) => s + p.stack, 0) / Math.max(1, a.length); }
  stage(): Stage {
    return stageOf(this.playersLeft(), this.paid, this.tables.length, this.cfg.tableSize, this.avgStack() / this.level().bb, !!this.cfg.satellite);
  }
  heroRank(): number {
    const h = this.hero();
    if (h.busted) return h.place;
    return 1 + this.alive().filter((p) => p.stack > h.stack).length;
  }
  handsUntilLevel() { return this.cfg.handsPerLevel - this.roundsAtLevel; }
  isLive() { return this.cfg.pace === 'live'; }
  levelMs() { return levelMinutes(this.cfg) * 60_000; }
  levelTimeLeftMs() { return Math.max(0, this.levelMs() - this.levelElapsedMs); }
  onBreak() { return this.breakLeftMs > 0; }

  /** Advance the live clock. Blinds change between hands (see startRound); breaks count down. */
  tick(ms: number) {
    if (!this.isLive() || this.finished || this.heroOut) return;
    if (this.breakLeftMs > 0) { this.breakLeftMs = Math.max(0, this.breakLeftMs - ms); return; }
    this.levelElapsedMs += ms;
    this.playedMs += ms;
  }

  skipBreak() { this.breakLeftMs = 0; }

  /** Live pace: start any levels whose time has come, with a break every few levels. */
  private applyClock() {
    while (this.breakLeftMs === 0 && this.levelElapsedMs >= this.levelMs()) {
      this.levelElapsedMs -= this.levelMs();
      this.levelIndex++;
      this.roundsAtLevel = 0;
      this.levelsSinceBreak++;
      if (this.levelsSinceBreak >= BREAK_EVERY_LEVELS) {
        this.levelsSinceBreak = 0;
        this.breakLeftMs = BREAK_MINUTES * 60_000;
        this.pushEvent('level', `Break: ${BREAK_MINUTES} minutes. Play resumes at ${this.fmtLevel(this.level())}.`);
      } else {
        this.pushEvent('level', `Blinds up: ${this.fmtLevel(this.level())}`);
      }
    }
  }
  /** Stacks and remaining payouts for full-field ICM. */
  icmField(): { ids: string[]; stacks: number[]; payouts: number[] } {
    const a = this.alive();
    const payouts: number[] = [];
    for (let k = 0; k < a.length; k++) payouts.push(this.prizes[k] ?? 0);
    return { ids: a.map((p) => p.id), stacks: a.map((p) => p.stack), payouts };
  }
  /** True when ICM matters enough to use $EV rather than chip EV. */
  icmRelevant(): boolean {
    const left = this.playersLeft();
    return left <= this.paid * 1.6 || this.tables.length === 1;
  }
  profileOf(id: string): ProfileKey | 'hero' { return this.players.get(id)!.profile; }

  private pushEvent(kind: TEvent['kind'], text: string) {
    this.events.push({ handNo: this.handNo, kind, text });
    if (this.events.length > 300) this.events.shift();
  }

  // ---------- bubble factors for ICM-aware bots ----------

  /** Satellite bubbles are far steeper than pay-jump bubbles: a locked-up stack risks a whole seat for nothing. */
  bubbleFactorCap(): number { return this.cfg.satellite ? 10 : 3; }

  private computeBubbleFactors() {
    this.bf.clear();
    if (!this.icmRelevant()) return;
    const { ids, stacks, payouts } = this.icmField();
    const n = ids.length;
    if (n < 2) return;
    const sorted = stacks.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(n / 2)];
    const vectors: number[][] = [stacks];
    const opp: number[] = [];
    for (let i = 0; i < n; i++) {
      // representative opponent: the player whose stack is closest to the median
      let j = -1, best = Infinity;
      for (let k = 0; k < n; k++) if (k !== i && Math.abs(stacks[k] - median) < best) { best = Math.abs(stacks[k] - median); j = k; }
      opp.push(j);
      const risk = Math.min(stacks[i], stacks[j]);
      const win = stacks.slice(); win[i] += risk; win[j] -= risk;
      const lose = stacks.slice(); lose[i] -= risk; lose[j] += risk;
      vectors.push(win, lose);
    }
    const vals = icmBatch(vectors, payouts, 700, this.handNo + 1);
    for (let i = 0; i < n; i++) {
      const gain = vals[1 + 2 * i][i] - vals[0][i];
      const loss = vals[0][i] - vals[2 + 2 * i][i];
      const cap = this.bubbleFactorCap();
      const bf = gain > 1e-9 ? Math.max(1, Math.min(cap, loss / gain)) : loss > 1e-9 ? cap : 1;
      this.bf.set(ids[i], bf);
    }
  }

  botCtx(id: string) {
    const prof = this.players.get(id)!.profile;
    const raw = this.bf.get(id) ?? 1;
    const aware = prof === 'hero' ? 1 : PROFILES[prof].icm;
    return { bf: 1 + (raw - 1) * aware };
  }

  // ---------- hands ----------

  private buildHand(t: TTable): { state: HandState; seatIds: string[] } | null {
    const occupied = t.seats.map((id, i) => (id && !this.players.get(id)!.busted ? i : -1)).filter((i) => i >= 0);
    if (occupied.length < 2) return null;
    // advance button to the next occupied seat
    let b = t.button;
    for (let k = 1; k <= t.seats.length; k++) {
      const s = (t.button + k) % t.seats.length;
      if (occupied.includes(s)) { b = s; break; }
    }
    t.button = b;
    const lvl = this.level();
    const seatIds = occupied.map((i) => t.seats[i]!);
    const seats: SeatInput[] = occupied.map((i) => {
      const p = this.players.get(t.seats[i]!)!;
      return { id: p.id, name: p.name, seat: i, stack: p.stack, isHero: p.isHero };
    });
    const deck = shuffleInPlace(fullDeck(), this.rng);
    const cfg: HandConfig = { sb: lvl.sb, bb: lvl.bb, ante: lvl.ante, anteMode: 'bb' };
    const state = createHand(cfg, seats, occupied.indexOf(b), deck);
    return { state, seatIds };
  }

  /** Start the next round. Returns the hero's hand (or null if the hero is out / tournament over). */
  startRound(): HandState | null {
    if (this.finished || this.heroOut) return null;
    if (this.isLive()) {
      this.applyClock();
      if (this.onBreak()) return null;
    }
    this.roundStartStacks.clear();
    for (const p of this.alive()) this.roundStartStacks.set(p.id, p.stack);
    this.handNo++;
    const t = this.heroTable()!;
    const built = this.buildHand(t);
    if (!built) return null;
    this.current = built.state;
    this.currentTable = t;
    this.currentSeatIds = built.seatIds;
    this.heroHands++;
    this.stackTrail.push(this.hero().stack / this.level().bb);
    if (this.stackTrail.length > 2000) this.stackTrail.shift();
    return this.current;
  }

  heroIndex(): number { return this.currentSeatIds.indexOf(HERO_ID); }
  isHeroTurn(): boolean { return !!this.current && !this.current.done && this.current.toAct === this.heroIndex(); }

  /** Perform one bot action at the hero's table. Returns false if it's the hero's turn or the hand is over. */
  stepBot(): boolean {
    const s = this.current;
    if (!s || s.done || s.toAct === this.heroIndex()) return false;
    const id = this.currentSeatIds[s.toAct];
    const p = this.players.get(id)!;
    const prof = PROFILES[p.profile as ProfileKey];
    applyAction(s, chooseBotAction(s, s.toAct, prof, this.botCtx(id), this.rng));
    return true;
  }

  /** Run all bot actions until the hero must act or the hand ends. */
  runBots() { while (this.stepBot()); }

  heroAct(a: PlayerAction) {
    if (!this.isHeroTurn()) throw new Error('Not hero turn');
    applyAction(this.current!, a);
  }

  /** Complete the round once the hero's hand is done: other tables, busts, balancing, levels. */
  finishRound(): HandRecord | null {
    const s = this.current;
    const t = this.currentTable;
    if (!s || !t || !s.done) return null;
    // apply results at hero table
    s.players.forEach((hp, k) => { this.players.get(this.currentSeatIds[k])!.stack = hp.stack; });
    const rec = this.recordHand(s, t);
    // HUD for everyone at the hero table
    s.players.forEach((_, k) => {
      const id = this.currentSeatIds[k];
      if (!this.hud.has(id)) this.hud.set(id, emptyCounts());
      accumulate(this.hud.get(id)!, computeFlags(s, k));
    });
    // other tables
    for (const other of this.tables) {
      if (other === t) continue;
      this.playTableInstantly(other);
    }
    this.processBusts();
    if (!this.finished) {
      this.rebalance();
      this.roundsAtLevel++;
      if (!this.isLive() && this.roundsAtLevel >= this.cfg.handsPerLevel) {
        this.levelIndex++;
        this.roundsAtLevel = 0;
        this.pushEvent('level', `Blinds up: ${this.fmtLevel(this.level())}`);
      }
      this.computeBubbleFactors();
      const st = this.stage();
      const order: Stage[] = ['early', 'middle', 'bubble', 'itm', 'final'];
      if (order.indexOf(st) > order.indexOf(this.stageReached)) this.stageReached = st;
    }
    this.current = null;
    return rec;
  }

  private playTableInstantly(t: TTable) {
    const built = this.buildHand(t);
    if (!built) return;
    const { state, seatIds } = built;
    let guard = 0;
    while (!state.done && guard++ < 400) {
      const id = seatIds[state.toAct];
      const prof = PROFILES[this.players.get(id)!.profile as ProfileKey];
      applyAction(state, chooseBotAction(state, state.toAct, prof, this.botCtx(id), this.rng));
    }
    state.players.forEach((hp, k) => { this.players.get(seatIds[k])!.stack = hp.stack; });
  }

  private recordHand(s: HandState, t: TTable): HandRecord {
    const hi = this.heroIndex();
    const bb = s.cfg.bb;
    const seats: SeatInfo[] = s.players.map((p, k) => ({
      id: p.id, name: p.name, seat: p.seat, stack: p.startStack, isHero: p.isHero,
      profile: this.players.get(this.currentSeatIds[k])!.profile,
      pos: POS_LABEL[positionOf(s, k)],
    }));
    const rec: HandRecord = {
      id: `${this.id}-h${this.handNo}`,
      tid: this.id,
      handNo: this.handNo,
      ts: Date.now(),
      level: this.levelIndex + 1,
      cfg: s.cfg,
      button: s.button,
      seats,
      deck: s.deck,
      moves: s.actions.map(toMove).filter((m): m is PlayerAction => m !== null),
      heroIndex: hi,
      tableId: t.id,
      playersLeft: this.playersLeft(),
      paid: this.paid,
      entrants: this.cfg.entrants,
      stage: this.stage(),
      avgStackBB: this.avgStack() / bb,
      heroStartBB: s.players[hi].startStack / bb,
      heroNet: s.result!.net[hi],
      heroNetBB: s.result!.net[hi] / bb,
      flags: computeFlags(s, hi),
    };
    this.history.push(rec);
    return rec;
  }

  private processBusts() {
    const busted = [...this.players.values()].filter((p) => !p.busted && p.stack <= 0);
    if (!busted.length) return;
    const before = this.playersLeft();
    busted.sort((a, b) => (this.roundStartStacks.get(b.id) ?? 0) - (this.roundStartStacks.get(a.id) ?? 0));
    const wasOutOfMoney = before > this.paid;
    const sat = this.cfg.satellite;
    busted.forEach((p, k) => {
      p.busted = true;
      p.place = before - busted.length + 1 + k;
      p.prize = this.prizes[p.place - 1] ?? 0;
      const t = this.tables.find((x) => x.id === p.tableId);
      if (t) t.seats[p.seat] = null;
      if (p.isHero) {
        this.heroOut = true;
        const prize = p.prize <= 0 ? '' : sat && p.prize === sat.seatValue ? `, which still wins a seat in the ${sat.target}` : ` for ${this.money(p.prize)}`;
        this.pushEvent('bust', `You finished ${ordinal(p.place)} of ${this.cfg.entrants}${prize}.`);
      }
    });
    const left = this.playersLeft();
    if (sat && left <= this.paid) {
      this.finishSatellite();
      return;
    }
    if (wasOutOfMoney && left <= this.paid && !this.bubbleBurst) {
      this.bubbleBurst = true;
      this.pushEvent('itm', `The bubble has burst. ${left} players are in the money.`);
    } else if (!this.bubbleBurst && left === this.paid + 1) {
      this.pushEvent('bubble', sat ? 'Seat bubble: one more elimination and everyone left wins a seat.' : 'Bubble: one more elimination and everyone left is paid.');
    }
    if (left === 1) {
      const w = this.alive()[0];
      w.place = 1;
      w.prize = this.prizes[0];
      this.finished = true;
      this.pushEvent('win', w.isHero ? `You won the tournament! ${this.money(w.prize)}` : `${w.name} wins the tournament.`);
    }
  }

  /** Everyone still in has a seat, so the satellite stops. Places among seat winners follow stack size. */
  private finishSatellite() {
    const sat = this.cfg.satellite!;
    const alive = this.alive().sort((a, b) => b.stack - a.stack);
    alive.forEach((p, k) => { p.place = k + 1; p.prize = this.prizes[k] ?? 0; });
    this.finished = true;
    this.bubbleBurst = true;
    this.stageReached = 'itm';
    const heroIn = alive.some((p) => p.isHero);
    this.pushEvent('win', heroIn
      ? `You won a seat in the ${sat.target}! The last ${alive.length} players each get one.`
      : `The satellite is over: the last ${alive.length} players each win a seat in the ${sat.target}.`);
  }

  private rebalance() {
    const size = this.cfg.tableSize;
    const count = (t: TTable) => t.seats.filter((x) => x).length;
    const heroTableBefore = this.heroTable()?.id;
    const moveTo = (id: string, to: TTable) => {
      const p = this.players.get(id)!;
      const from = this.tables.find((t) => t.id === p.tableId);
      if (from) from.seats[p.seat] = null;
      const free = to.seats.map((s, i) => (s ? -1 : i)).filter((i) => i >= 0);
      const seat = free[this.rng.int(free.length)];
      to.seats[seat] = id;
      p.tableId = to.id;
      p.seat = seat;
    };
    const left = this.playersLeft();
    if (left <= size && this.tables.length > 1) {
      // final table: redraw seats
      const ft: TTable = { id: 1, seats: new Array(size).fill(null), button: this.rng.int(size) };
      const ids = shuffleInPlace(this.alive().map((p) => p.id), this.rng);
      this.tables = [ft];
      ids.forEach((id) => {
        const p = this.players.get(id)!;
        p.tableId = -1;
        moveTo(id, ft);
      });
      if (!this.finalTableAnnounced) {
        this.finalTableAnnounced = true;
        this.pushEvent('final', `Final table! ${left} players left. Payouts: ${this.prizes.slice(0, left).map((x, k) => `${ordinal(k + 1)} ${this.money(x, 0)}`).join(', ')}`);
      }
      return;
    }
    // break tables
    const needed = Math.ceil(left / size);
    while (this.tables.length > needed) {
      const victim = this.tables.slice().sort((a, b) => count(a) - count(b) || b.id - a.id)[0];
      this.tables = this.tables.filter((t) => t !== victim);
      const ids = victim.seats.filter((x): x is string => !!x);
      for (const id of ids) {
        const target = this.tables.slice().sort((a, b) => count(a) - count(b))[0];
        this.players.get(id)!.tableId = -1;
        moveTo(id, target);
      }
      this.pushEvent('break', `Table ${victim.id} broke; players moved to other tables.`);
    }
    // balance
    for (let guard = 0; guard < 50; guard++) {
      const sorted = this.tables.slice().sort((a, b) => count(a) - count(b));
      const small = sorted[0], big = sorted[sorted.length - 1];
      if (count(big) - count(small) <= 1) break;
      // move the player who would be big blind next at the big table
      const occ = big.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
      const after = (from: number, k: number) => {
        let s = from, found = 0;
        for (let step = 1; step <= big.seats.length * 2; step++) {
          s = (from + step) % big.seats.length;
          if (occ.includes(s)) { found++; if (found === k) return s; }
        }
        return occ[0];
      };
      const seat = after(big.button, 3);
      moveTo(big.seats[seat]!, small);
    }
    const heroTableAfter = this.heroTable()?.id;
    if (heroTableBefore !== undefined && heroTableAfter !== heroTableBefore && !this.heroOut) {
      this.pushEvent('move', `You have been moved to table ${heroTableAfter}.`);
    }
  }

  // ---------- save / resume ----------

  serialize(): TournamentSnapshot {
    return {
      v: 1,
      id: this.id,
      cfg: this.cfg,
      players: [...this.players.values()],
      tables: this.tables,
      levelIndex: this.levelIndex,
      roundsAtLevel: this.roundsAtLevel,
      handNo: this.handNo,
      heroHands: this.heroHands,
      rng: this.rng.state(),
      current: this.current,
      currentTableId: this.currentTable?.id ?? null,
      currentSeatIds: this.currentSeatIds,
      events: this.events.slice(-60),
      hud: [...this.hud.entries()],
      bf: [...this.bf.entries()],
      finished: this.finished,
      heroOut: this.heroOut,
      bubbleBurst: this.bubbleBurst,
      stageReached: this.stageReached,
      roundStartStacks: [...this.roundStartStacks.entries()],
      finalTableAnnounced: this.finalTableAnnounced,
      stackTrail: this.stackTrail,
      levelElapsedMs: this.levelElapsedMs,
      breakLeftMs: this.breakLeftMs,
      levelsSinceBreak: this.levelsSinceBreak,
      playedMs: this.playedMs,
    };
  }

  static restore(snap: TournamentSnapshot): Tournament {
    const t = Object.create(Tournament.prototype) as Tournament;
    const w = t as unknown as Record<string, unknown>;
    w.id = snap.id;
    w.cfg = snap.cfg;
    w.prizes = prizesFor(snap.cfg);
    w.paid = paidFor(snap.cfg, w.prizes as number[]);
    t.players = new Map(snap.players.map((p) => [p.id, p]));
    t.tables = snap.tables;
    t.levelIndex = snap.levelIndex;
    t.roundsAtLevel = snap.roundsAtLevel;
    t.handNo = snap.handNo;
    t.heroHands = snap.heroHands;
    t.rng = makeRng(snap.rng);
    t.current = snap.current;
    t.currentTable = snap.currentTableId !== null ? t.tables.find((x) => x.id === snap.currentTableId) ?? null : null;
    t.currentSeatIds = snap.currentSeatIds;
    t.events = snap.events;
    t.history = [];
    t.hud = new Map(snap.hud);
    t.bf = new Map(snap.bf);
    t.finished = snap.finished;
    t.heroOut = snap.heroOut;
    t.bubbleBurst = snap.bubbleBurst;
    t.stageReached = snap.stageReached;
    w.roundStartStacks = new Map(snap.roundStartStacks);
    w.finalTableAnnounced = snap.finalTableAnnounced;
    t.stackTrail = snap.stackTrail ?? [];
    t.levelElapsedMs = snap.levelElapsedMs ?? 0;
    t.breakLeftMs = snap.breakLeftMs ?? 0;
    t.levelsSinceBreak = snap.levelsSinceBreak ?? 0;
    t.playedMs = snap.playedMs ?? 0;
    return t;
  }

  result(): TournamentResult {
    const h = this.hero();
    return {
      id: this.id,
      ts: Date.now(),
      name: this.cfg.name,
      entrants: this.cfg.entrants,
      buyIn: this.cfg.buyIn,
      place: h.place > 0 ? h.place : this.heroRank(),
      prize: h.prize,
      handsPlayed: this.heroHands,
      stageReached: this.stageReached,
      start: this.cfg.start,
      field: this.cfg.field,
      ...(this.cfg.currency ? { currency: this.cfg.currency } : {}),
      ...(this.cfg.satellite ? { seat: h.prize === this.cfg.satellite.seatValue } : {}),
    };
  }
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
