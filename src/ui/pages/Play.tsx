import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Tournament, HERO_ID, ordinal, type TEvent } from '../../tournament/tournament';
import { PRESETS, STAGE_LABEL, type Preset, type HeroStackOption } from '../../tournament/structure';
import { FIELD_MIXES, PROFILES, type FieldMix, type ProfileKey } from '../../bots/profiles';
import { type PlayerAction, legalActions, potSize, STREET_NAMES } from '../../engine/hand';
import { randomSeed } from '../../engine/rng';
import { liveAdvice, gradeHeroAction, type DecisionRecord } from '../../coach/session';
import { KIND_LABEL, catLabel, type Advice } from '../../coach/coach';
import { overallAccuracy, decisionLeaks } from '../../analysis/leaks';
import { pct as pctOf } from '../../analysis/handFlags';
import { useData, setSettings, recordHand, recordResult, saveActive, clearActive, type Settings } from '../store';
import { getActiveTournament, setActiveTournament, useNav } from '../nav';
import { Felt, fmtAmt } from '../components/Felt';
import { GradeBadge, RangeGrid, Seg, Tile, fmtMoney } from '../components/common';
import { LineChart } from '../components/charts';
import { levelMinutes, liveActionDelayMs, liveDealDelayMs, liveEndDelayMs, fmtClock, BREAK_EVERY_LEVELS, BREAK_MINUTES } from '../../tournament/pace';

export function PlayPage({ preset }: { preset?: string }) {
  const [t, setT] = useState<Tournament | null>(() => getActiveTournament());
  const start = (tt: Tournament) => { setActiveTournament(tt); setT(tt); saveActive(() => tt.serialize()); };
  const leave = () => { setActiveTournament(null); clearActive(); setT(null); };
  if (!t) return <Setup onStart={start} initial={preset} />;
  return <TableView key={t.id} t={t} onLeave={leave} onNew={leave} />;
}

// ---------------------------------------------------------------------------

function Setup({ onStart, initial }: { onStart: (t: Tournament) => void; initial?: string }) {
  const { settings } = useData();
  const [preset, setPreset] = useState<Preset>(PRESETS.find((p) => p.key === initial) ?? PRESETS[1]);
  const [field, setField] = useState<FieldMix>(preset.config.field);
  const [heroStack, setHeroStack] = useState<HeroStackOption>(preset.config.heroStack);
  const scenario = preset.config.start !== 'beginning';
  const begin = () => {
    const cfg = { ...preset.config, field, heroStack, pace: settings.pace, seed: randomSeed() };
    onStart(new Tournament(cfg, settings.heroName || 'You'));
  };
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Play a tournament</h1>
          <p>Full multi-table fields with rising blinds, table breaks, a real bubble and a final table. Every other table plays its hands in the background while you play yours.</p>
        </div>
      </div>
      <div className="grid cols-3">
        {PRESETS.map((p) => (
          <button key={p.key} className={`panel preset ${preset.key === p.key ? 'sel' : ''}`} onClick={() => { setPreset(p); setField(p.config.field); setHeroStack(p.config.heroStack); }}>
            <div className="spread">
              <h3 style={{ margin: 0 }}>{p.label}</h3>
              <span className="pill">{p.config.start === 'beginning' ? 'Full MTT' : 'Scenario'}</span>
            </div>
            <p className="small muted">{p.blurb}</p>
            <div className="row small">
              <span className="pill">{p.config.entrants} players</span>
              <span className="pill">{p.config.currency ?? '$'}{p.config.buyIn} buy-in</span>
              {p.config.satellite && <span className="pill accent">{p.config.satellite.guaranteedSeats} seats</span>}
              <span className="pill">{settings.pace === 'live' ? `${levelMinutes(p.config)}-minute levels` : `${p.config.handsPerLevel} hands/level`}</span>
            </div>
          </button>
        ))}
      </div>
      <div className="panel stack">
        <h3>Options</h3>
        <div className="grid cols-2">
          <div className="stack">
            <span className="label">Opponents</span>
            <Seg value={field} onChange={setField} options={(Object.keys(FIELD_MIXES) as FieldMix[]).map((k) => ({ v: k, label: FIELD_MIXES[k].label }))} label="Field" />
          </div>
          {scenario && (
            <div className="stack">
              <span className="label">Your stack at the start</span>
              <Seg value={heroStack} onChange={setHeroStack} options={[{ v: 'random', label: 'Random' }, { v: 'short', label: 'Short' }, { v: 'average', label: 'Average' }, { v: 'big', label: 'Big' }]} label="Hero stack" />
            </div>
          )}
          <div className="stack">
            <span className="label">Coach feedback</span>
            <Seg value={settings.coach} onChange={(v) => setSettings({ coach: v })} options={[{ v: 'instant', label: 'Stop on mistakes' }, { v: 'hand', label: 'After each hand' }, { v: 'off', label: 'Silent (review later)' }]} label="Coach" />
          </div>
          <div className="stack">
            <span className="label">Pace</span>
            <Seg value={settings.pace} onChange={(v) => setSettings({ pace: v })} options={[{ v: 'fast', label: 'Fast' }, { v: 'live', label: 'Live (real time)' }]} label="Pace" />
            <span className="small muted">{settings.pace === 'live'
              ? `Like a real table: about 30 hands an hour, ${levelMinutes(preset.config)}-minute levels by the clock, a ${BREAK_MINUTES}-minute break every ${BREAK_EVERY_LEVELS} levels, and you sit through every hand you fold. The clock pauses when you leave or read the coach, and you can resume later.`
              : `Blinds go up every ${preset.config.handsPerLevel} hands and hands you've folded are skipped.`}</span>
          </div>
          {settings.pace === 'fast' && (
            <div className="stack">
              <span className="label">Speed</span>
              <Seg value={settings.speed} onChange={(v) => setSettings({ speed: v })} options={[{ v: 'slow', label: 'Relaxed' }, { v: 'normal', label: 'Normal' }, { v: 'fast', label: 'Fast' }]} label="Speed" />
            </div>
          )}
        </div>
        <div className="row">
          <button className="btn primary" onClick={begin}>Take your seat</button>
          <span className="small muted">Every decision is graded in the background either way; review it later in Analyze.</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

type Overlay =
  | { kind: 'decision'; rec: DecisionRecord; advice: Advice }
  | { kind: 'hand'; recs: DecisionRecord[] }
  | { kind: 'result' }
  | { kind: 'leave' };

const SPEED: Record<Settings['speed'], { bot: number; end: number; showdown: number }> = {
  slow: { bot: 1000, end: 1400, showdown: 3200 },
  normal: { bot: 600, end: 900, showdown: 2400 },
  fast: { bot: 220, end: 450, showdown: 1400 },
};

const isBad = (g: string) => g === 'inaccuracy' || g === 'mistake' || g === 'blunder';

function TableView({ t, onLeave, onNew }: { t: Tournament; onLeave: () => void; onNew: () => void }) {
  const { settings } = useData();
  const nav = useNav();
  const [, setV] = useState(0);
  const bump = useCallback(() => setV((x) => x + 1), []);
  const [overlay, setOverlay] = useState<Overlay | null>(t.heroOut || t.finished ? { kind: 'result' } : null);
  const [hint, setHint] = useState<Advice | null>(null);
  const [busy, setBusy] = useState(false);
  const [feed, setFeed] = useState<DecisionRecord[]>([]);
  const [toasts, setToasts] = useState<TEvent[]>([]);
  const [sessionDecisions, setSessionDecisions] = useState<DecisionRecord[]>([]);
  const handDecisions = useRef<DecisionRecord[]>([]);
  const seenEvents = useRef(t.events.length);
  const sp = SPEED[settings.speed];
  const live = t.isLive();
  /** Live pace: when the dealer finishes shuffling and deals the next hand. A ref, so it is set before
   *  recording the hand re-renders the table (which would otherwise deal straight away). */
  const dealAt = useRef(0);

  const pushToasts = useCallback(() => {
    const fresh = t.events.slice(seenEvents.current);
    seenEvents.current = t.events.length;
    if (!fresh.length) return;
    setToasts((x) => [...x, ...fresh].slice(-3));
    setTimeout(() => setToasts((x) => x.filter((e) => !fresh.includes(e))), 5000);
  }, [t]);

  // make sure a hand is running (at live pace: after the shuffle, and not during a break)
  useEffect(() => {
    if (t.current || t.heroOut || t.finished || overlay) return;
    if (live) {
      if (t.onBreak()) return;
      const wait = dealAt.current - Date.now();
      if (wait > 0) { const id = setTimeout(bump, Math.min(wait, 1000)); return () => clearTimeout(id); }
    }
    t.startRound();
    pushToasts();
    bump();
  });

  // live clock: runs while you're at the table, pauses when the tab is hidden or the coach is open
  useEffect(() => {
    if (!live || (overlay && overlay.kind !== 'result')) return;
    let last = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      const dt = Math.min(5000, now - last);
      last = now;
      if (document.visibilityState !== 'visible') return;
      t.tick(dt);
      bump();
    }, 1000);
    return () => clearInterval(id);
  }, [t, live, overlay, bump]);

  const endHand = useCallback(() => {
    if (t.isLive()) dealAt.current = Date.now() + liveDealDelayMs();
    const rec = t.finishRound();
    if (rec) recordHand(rec, handDecisions.current);
    const recs = handDecisions.current;
    handDecisions.current = [];
    pushToasts();
    if (t.heroOut || t.finished) {
      recordResult(t.result());
      clearActive();
      setOverlay({ kind: 'result' });
    } else {
      saveActive(() => t.serialize());
      if (settings.coach === 'hand' && recs.some((r) => isBad(r.grade))) setOverlay({ kind: 'hand', recs });
    }
    bump();
  }, [t, settings.coach, pushToasts, bump]);

  // bot loop: one timer per step of the hand, so re-renders (the live clock) don't restart it
  const step = t.current ? `${t.handNo}:${t.current.actions.length}:${t.current.done}` : '';
  useEffect(() => {
    const s = t.current;
    if (!s || overlay || busy) return;
    if (s.done) {
      const hi = t.heroIndex();
      const heroIn = !s.players[hi].folded;
      const showdown = !!s.result?.showdown;
      const id = setTimeout(endHand, live ? liveEndDelayMs(showdown) : showdown ? sp.showdown : heroIn ? sp.end : Math.min(sp.end, 500));
      return () => clearTimeout(id);
    }
    if (t.isHeroTurn()) return;
    const heroFolded = s.players[t.heroIndex()].folded;
    if (heroFolded && !live) {
      // fast-forward hands you're no longer in
      const id = setTimeout(() => { t.runBots(); bump(); }, 150);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => { t.stepBot(); bump(); }, live ? liveActionDelayMs(s) : sp.bot * (0.6 + Math.random() * 0.8));
    return () => clearTimeout(id);
  }, [step, overlay, busy, live, sp, t, endHand, bump]);

  const act = useCallback((a: PlayerAction) => {
    if (!t.isHeroTurn() || busy) return;
    setBusy(true);
    setTimeout(() => {
      let graded: ReturnType<typeof gradeHeroAction> | null = null;
      try { graded = gradeHeroAction(t, a, hint); } catch (e) { console.error('coach error', e); }
      t.heroAct(a);
      setHint(null);
      if (graded && graded.record.grade !== 'unscored') {
        const r = graded.record;
        handDecisions.current.push(r);
        setFeed((f) => [r, ...f].slice(0, 40));
        setSessionDecisions((d) => [...d, r]);
        if (settings.coach === 'instant' && isBad(r.grade)) setOverlay({ kind: 'decision', rec: r, advice: graded.advice });
      }
      saveActive(() => t.serialize());
      setBusy(false);
      bump();
    }, 20);
  }, [t, busy, hint, settings.coach, bump]);

  const askHint = () => {
    try { setHint(liveAdvice(t)); } catch (e) { console.error(e); }
  };

  const s = t.current;
  const lvl = t.level();
  const hero = t.hero();
  const heroIdx = t.heroIndex();
  const meta = (i: number) => {
    if (!s) return {};
    const id = t.currentSeatIds[i];
    if (id === HERO_ID) return {};
    const h = t.hud.get(id);
    const prof = t.profileOf(id) as ProfileKey;
    return {
      hud: settings.hud && h && h.hands >= 3 ? `${Math.round(pctOf(h.vpip, h.hands))}/${Math.round(pctOf(h.pfr, h.hands))}/${Number.isNaN(pctOf(h.threeBet, h.threeBetOpp)) ? '–' : Math.round(pctOf(h.threeBet, h.threeBetOpp))} · ${h.hands}h` : undefined,
      tag: settings.revealTypes ? PROFILES[prof]?.short : undefined,
    };
  };

  const message = s && !s.done && t.isHeroTurn() ? (busy ? 'Coach is checking your decision…' : 'Your turn') : s?.done ? handResultText(t) : undefined;
  const acc = overallAccuracy(sessionDecisions);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t.cfg.name}</h1>
          <p>Table {t.heroTable()?.id ?? '–'} · Hand {t.handNo} · {STAGE_LABEL[t.stage()]}{t.icmRelevant() ? ' · ICM in play' : ''}{live ? ` · played ${fmtClock(t.playedMs)}` : ''}</p>
        </div>
        <div className="row">
          <Seg value={settings.units} onChange={(v) => setSettings({ units: v })} options={[{ v: 'bb', label: 'BB' }, { v: 'chips', label: 'Chips' }]} label="Units" />
          <button className="btn" onClick={() => setOverlay({ kind: 'leave' })}>Leave</button>
        </div>
      </div>
      <div className="play-layout">
        <div className="stack">
          {s ? (
            <Felt
              s={s}
              tableSize={t.cfg.tableSize}
              heroIdx={heroIdx}
              meta={meta}
              units={settings.units}
              message={message}
              toasts={toasts.length ? toasts.map((e, i) => <div className="toast" key={i}>{e.text}</div>) : undefined}
              overlay={overlay ? <OverlayView o={overlay} t={t} close={() => setOverlay(null)} onLeave={onLeave} onNew={onNew} nav={nav} session={sessionDecisions} /> : undefined}
            />
          ) : (
            <div className="felt-wrap"><div className="felt" />
              {live && !overlay && !t.heroOut && !t.finished && <LiveWait t={t} dealAt={dealAt.current} onSkipBreak={() => { t.skipBreak(); bump(); }} />}
              {overlay && <OverlayView o={overlay} t={t} close={() => setOverlay(null)} onLeave={onLeave} onNew={onNew} nav={nav} session={sessionDecisions} />}</div>
          )}
          {s && t.isHeroTurn() && !overlay && <ActionBar t={t} onAct={act} busy={busy} onHint={askHint} hint={hint} units={settings.units} />}
          {hint && t.isHeroTurn() && <AdvicePanel advice={hint} title="Coach hint" />}
        </div>
        <aside className="side">
          <div className="panel stack">
            <div className="clock">
              <Tile label={`Level ${t.levelIndex + 1}`} value={<span className="num">{compact(lvl.sb)}/{compact(lvl.bb)}</span>} sub={live ? `ante ${compact(lvl.ante)} · ${fmtClock(t.levelTimeLeftMs())} left` : `ante ${compact(lvl.ante)} · next in ${t.handsUntilLevel()}`} />
              <Tile label="Players" value={<span className="num">{t.playersLeft()}/{t.cfg.entrants}</span>} sub={t.cfg.satellite ? `${t.paid} seats` : `${t.paid} paid`} />
              <Tile label="Your stack" value={<span className="num">{(hero.stack / lvl.bb).toFixed(1)}bb</span>} sub={`rank ${t.heroRank()} · avg ${(t.avgStack() / lvl.bb).toFixed(0)}bb`} />
            </div>
            <PayLadder t={t} />
          </div>
          <div className="panel stack">
            <div className="spread">
              <h3 style={{ margin: 0 }}>Coach</h3>
              {acc.scored > 0 && <span className="pill accent num">{acc.good}/{acc.scored} good ({Math.round(acc.pct)}%)</span>}
            </div>
            {feed.length === 0 ? <p className="small muted">Your graded decisions appear here. Preflop all-ins use ICM near the money; postflop calls are checked against the opponent’s likely range.</p> : (
              <div className="feed">{feed.map((r) => <FeedItem key={r.id} r={r} />)}</div>
            )}
          </div>
          {t.stackTrail.length > 3 && (
            <div className="panel">
              <h3>Your stack (bb)</h3>
              <LineChart values={t.stackTrail} height={150} width={320} ariaLabel="Your stack in big blinds by hand" xLabel={(i) => `hand ${i + 1}`} format={(v) => v.toFixed(0)} />
            </div>
          )}
          {s && <HandLog t={t} units={settings.units} />}
        </aside>
      </div>
    </div>
  );
}

const compact = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(2)}M` : n >= 1000 ? `${+(n / 1000).toFixed(2)}K` : String(n));

function handResultText(t: Tournament): string | undefined {
  const s = t.current;
  if (!s?.result) return undefined;
  const w = s.result.won.map((x, i) => (x > 0 ? i : -1)).filter((i) => i >= 0);
  const names = w.map((i) => (i === t.heroIndex() ? 'You' : s.players[i].name)).join(' & ');
  const desc = s.result.showdown && w.length ? ` with ${s.result.descriptions[w[0]]?.toLowerCase()}` : '';
  return `${names} win${w.length === 1 && names !== 'You' ? 's' : ''} ${fmtAmt(s.result.won.reduce((a, b) => a + b, 0), s.cfg.bb, 'bb')}${desc}`;
}

/** Live pace, between hands: the dealer shuffling, or the break clock. */
function LiveWait({ t, dealAt, onSkipBreak }: { t: Tournament; dealAt: number; onSkipBreak: () => void }) {
  if (t.onBreak()) {
    return (
      <div className="felt-wait">
        <span className="label">Break</span>
        <strong className="num">{fmtClock(t.breakLeftMs)}</strong>
        <span className="small">Play resumes at {t.fmtLevel(t.level())}.</span>
        <button className="btn small" onClick={onSkipBreak}>Skip break</button>
      </div>
    );
  }
  const wait = dealAt - Date.now();
  if (wait <= 0) return null;
  return (
    <div className="felt-wait">
      <span className="small">The dealer is shuffling. Next hand in <span className="num">{fmtClock(wait)}</span></span>
    </div>
  );
}

function PayLadder({ t }: { t: Tournament }) {
  const left = t.playersLeft();
  const out = left > t.paid ? left - t.paid : 0;
  const cur = t.cfg.currency;
  const sat = t.cfg.satellite;
  if (sat) {
    const cash = t.prizes[t.paid];
    return (
      <div className="small">
        {out} more elimination{out === 1 ? '' : 's'} and everyone left wins a seat in the {sat.target} ({fmtMoney(sat.seatValue, cur)}).
        {cash ? ` ${ordinal(t.paid + 1)} gets the leftover ${fmtMoney(cash, cur)}.` : ''} Seats are equal, so chips beyond what you need to survive are worth almost nothing.
      </div>
    );
  }
  const nextPrize = t.prizes[Math.min(left - 2, t.prizes.length - 1)] ?? 0;
  return (
    <div className="small">
      {out > 0
        ? <span>{out} more elimination{out > 1 ? 's' : ''} to the money. Min-cash {fmtMoney(t.prizes[t.paid - 1], cur)}; 1st {fmtMoney(t.prizes[0], cur)}.</span>
        : <span>In the money. Next pay jump: {fmtMoney(nextPrize, cur)} ({ordinal(left - 1)}). 1st pays {fmtMoney(t.prizes[0], cur)}.</span>}
    </div>
  );
}

function FeedItem({ r }: { r: DecisionRecord }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`stripe ${r.grade} stack`} style={{ gap: 4 }}>
      <div className="spread">
        <span className="small"><strong>{r.handClass}</strong> · {r.pos} · {STREET_NAMES[r.street]}</span>
        <GradeBadge grade={r.grade} />
      </div>
      <span className="small">{r.actionText}{r.best.length ? <span className="muted"> · best: {r.best.map(catLabel).join(' / ')}</span> : null}</span>
      {r.summary && <span className="small muted">{r.summary}</span>}
      {r.lines.length > 0 && <button className="btn ghost small" style={{ justifySelf: 'start', padding: 0 }} onClick={() => setOpen(!open)}>{open ? 'Hide details' : 'Why?'}</button>}
      {open && <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{r.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
    </div>
  );
}

function HandLog({ t, units }: { t: Tournament; units: 'bb' | 'chips' }) {
  const s = t.current!;
  const lines: string[] = [];
  let street = -1;
  for (const a of s.actions) {
    if (a.street !== street) { street = a.street; if (street > 0) lines.push(`— ${STREET_NAMES[street]} —`); }
    const n = a.p === t.heroIndex() ? 'You' : s.players[a.p].name;
    const amt = fmtAmt(a.type === 'call' || a.type === 'ante' || a.type === 'sb' || a.type === 'bb' ? a.add : a.to, s.cfg.bb, units);
    const txt: Record<string, string> = { ante: `ante ${amt}`, sb: `posts SB ${amt}`, bb: `posts BB ${amt}`, fold: 'folds', check: 'checks', call: `calls ${amt}`, bet: `bets ${amt}`, raise: `raises to ${amt}` };
    lines.push(`${n} ${txt[a.type]}${a.allIn ? ' (all-in)' : ''}`);
  }
  return (
    <div className="panel">
      <h3>Hand log</h3>
      <div className="log">{lines.map((l, i) => <span key={i}>{l}</span>)}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ActionBar({ t, onAct, busy, onHint, hint, units }: { t: Tournament; onAct: (a: PlayerAction) => void; busy: boolean; onHint: () => void; hint: Advice | null; units: 'bb' | 'chips' }) {
  const s = t.current!;
  const L = legalActions(s);
  const bb = s.cfg.bb;
  const me = s.players[s.toAct];
  const pot = potSize(s);
  const presets = useMemo(() => {
    const out: { label: string; to: number }[] = [];
    if (!L.canRaise) return out;
    const add = (label: string, to: number) => {
      const v = Math.max(L.minRaiseTo, Math.min(L.maxRaiseTo, Math.round(to)));
      if (!out.some((o) => o.to === v)) out.push({ label, to: v });
    };
    if (s.street === 0) {
      if (s.currentBet <= bb) { add('2x', 2 * bb); add('2.2x', 2.2 * bb); add('2.5x', 2.5 * bb); add('3x', 3 * bb); }
      else { add('2.5x', s.currentBet * 2.5); add('3x', s.currentBet * 3); add('4x', s.currentBet * 4); }
    } else if (s.currentBet === 0) {
      add('⅓ pot', pot / 3); add('½ pot', pot / 2); add('¾ pot', pot * 0.75); add('Pot', pot);
    } else {
      const callTotal = pot + L.toCall;
      add('Min', L.minRaiseTo); add('Pot', s.currentBet + callTotal);
    }
    return out;
  }, [s, s.actions.length, L.canRaise]);
  const defaultTo = presets[1]?.to ?? presets[0]?.to ?? L.minRaiseTo;
  const [to, setTo] = useState(defaultTo);
  useEffect(() => setTo(defaultTo), [s.actions.length, defaultTo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'f' && L.canFold) onAct({ type: 'fold' });
      else if (e.key === 'c') onAct(L.canCheck ? { type: 'check' } : { type: 'call' });
      else if (e.key === 'r' && L.canRaise) onAct({ type: 'raise', to });
      else if (e.key === 'h') onHint();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const odds = L.toCall > 0 ? L.callAmount / (pot + L.callAmount) : 0;
  const isAllIn = to >= L.maxRaiseTo;
  const step = Math.max(1, Math.round(bb / 10));
  return (
    <div className="actionbar" aria-busy={busy}>
      <div className="spread">
        <span className="small">
          {L.toCall > 0 ? <>To call <strong>{fmtAmt(L.callAmount, bb, units)}</strong> · pot {fmtAmt(pot, bb, units)} · you need <strong>{Math.round(odds * 100)}%</strong> equity</> : <>Pot {fmtAmt(pot, bb, units)} · no bet to you</>}
        </span>
        <button className="btn small" onClick={onHint} disabled={busy || !!hint}>Hint <span className="kbd">H</span></button>
      </div>
      <div className="buttons">
        {L.canFold ? <button className="btn fold" disabled={busy} onClick={() => onAct({ type: 'fold' })}>Fold <span className="kbd">F</span></button> : <button className="btn" disabled>Fold</button>}
        {L.canCheck
          ? <button className="btn call" disabled={busy} onClick={() => onAct({ type: 'check' })}>Check <span className="kbd">C</span></button>
          : <button className="btn call" disabled={busy} onClick={() => onAct({ type: 'call' })}>{L.callAmount >= me.stack ? 'Call all-in' : `Call ${fmtAmt(L.callAmount, bb, units)}`} <span className="kbd">C</span></button>}
        {L.canRaise
          ? <button className="btn raise" disabled={busy} onClick={() => onAct({ type: 'raise', to })}>{isAllIn ? 'All-in' : `${s.currentBet === 0 ? 'Bet' : 'Raise to'} ${fmtAmt(to, bb, units)}`} <span className="kbd">R</span></button>
          : <button className="btn" disabled>Raise</button>}
      </div>
      {L.canRaise && (
        <>
          <div className="presets">
            {presets.map((p) => <button key={p.label} className={`btn small ${p.to === to ? 'primary' : ''}`} onClick={() => setTo(p.to)}>{p.label}</button>)}
            <button className={`btn small ${isAllIn ? 'primary' : ''}`} onClick={() => setTo(L.maxRaiseTo)}>All-in</button>
          </div>
          <div className="sizer">
            <input type="range" id="raise-size" min={L.minRaiseTo} max={L.maxRaiseTo} step={step} value={to} onChange={(e) => setTo(Number(e.target.value))} aria-label="Raise size" />
            <input className="input num" id="raise-size-bb" type="number" step={0.1} min={L.minRaiseTo / bb} max={L.maxRaiseTo / bb} value={Math.round((to / bb) * 10) / 10}
              onChange={(e) => setTo(Math.max(L.minRaiseTo, Math.min(L.maxRaiseTo, Math.round(Number(e.target.value) * bb))))} aria-label="Raise size in big blinds" />
          </div>
        </>
      )}
    </div>
  );
}

export function AdvicePanel({ advice, title }: { advice: Advice; title: string }) {
  const evs = Object.entries(advice.ev).filter(([, v]) => v !== undefined) as [string, number][];
  return (
    <div className="panel stack">
      <div className="spread">
        <h3 style={{ margin: 0 }}>{title}: {advice.title}</h3>
        <span className="pill accent">Best: {advice.best.map(catLabel).join(' / ')}</span>
      </div>
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="stack small">
          <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>{advice.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
          {evs.length > 1 && (
            <div className="row">{evs.map(([k, v]) => <span key={k} className="pill num">{catLabel(k as never)}: {v >= 0 ? '+' : ''}{v.toFixed(2)}bb{advice.icm ? '-eq' : ''}</span>)}</div>
          )}
          {Object.keys(advice.freq).length > 0 && (
            <div className="row">{Object.entries(advice.freq).map(([k, v]) => <span key={k} className="pill num">{catLabel(k as never)} {Math.round((v ?? 0) * 100)}%</span>)}</div>
          )}
          {advice.villains.map((v) => (
            <div key={v.name} className="small muted">{v.name} ({v.profile}): about {v.pct.toFixed(0)}% of hands — {v.text.length > 120 ? v.text.slice(0, 120) + '…' : v.text}</div>
          ))}
        </div>
        {advice.chart && <RangeGrid range={advice.chart.range} second={advice.chart.second} labels={[advice.chart.label, advice.chart.secondLabel]} hero={undefined} />}
      </div>
    </div>
  );
}

function OverlayView({ o, t, close, onLeave, onNew, nav, session }: {
  o: Overlay; t: Tournament; close: () => void; onLeave: () => void; onNew: () => void; nav: ReturnType<typeof useNav>; session: DecisionRecord[];
}) {
  if (o.kind === 'decision') {
    const r = o.rec;
    return (
      <div className="overlay">
        <div className="panel stack">
          <div className="spread">
            <span className="label">{KIND_LABEL[r.kind]}</span>
            <GradeBadge grade={r.grade} />
          </div>
          <h2>{r.summary || r.title}</h2>
          <div className="small">You: <strong>{r.actionText}</strong> · Best: <strong>{r.best.map(catLabel).join(' / ')}</strong>{r.evLossBB ? <> · cost ≈ <strong className="num">{r.evLossBB.toFixed(2)}bb</strong></> : null}</div>
          <ul className="small" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>{r.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
          {o.advice.chart && <RangeGrid range={o.advice.chart.range} second={o.advice.chart.second} labels={[o.advice.chart.label, o.advice.chart.secondLabel]} />}
          <button className="btn primary" onClick={close} autoFocus>Continue</button>
        </div>
      </div>
    );
  }
  if (o.kind === 'hand') {
    return (
      <div className="overlay">
        <div className="panel stack">
          <h2>Hand review</h2>
          {o.recs.map((r) => (
            <div key={r.id} className={`stripe ${r.grade} stack`} style={{ gap: 4 }}>
              <div className="spread"><strong>{r.title}</strong><GradeBadge grade={r.grade} /></div>
              <span className="small">You: {r.actionText} · Best: {r.best.map(catLabel).join(' / ')}</span>
              <span className="small muted">{r.summary}</span>
            </div>
          ))}
          <button className="btn primary" onClick={close} autoFocus>Next hand</button>
        </div>
      </div>
    );
  }
  if (o.kind === 'leave') {
    return (
      <div className="overlay">
        <div className="panel stack">
          <h2>Leave this tournament?</h2>
          <p className="muted">Hands you played and their grades stay in Analyze. The tournament result won’t be recorded.</p>
          <div className="row">
            <button className="btn danger" onClick={onLeave}>Leave tournament</button>
            <button className="btn primary" onClick={close}>Keep playing</button>
          </div>
        </div>
      </div>
    );
  }
  const r = t.result();
  const acc = overallAccuracy(session);
  const leaks = decisionLeaks(session).slice(0, 3);
  const profit = r.prize - r.buyIn;
  return (
    <div className="overlay">
      <div className="panel stack">
        <span className="label">{t.cfg.name}</span>
        <h2>{r.seat ? `You won a seat in the ${t.cfg.satellite!.target}!` : !t.cfg.satellite && t.finished && r.place === 1 ? 'You won the tournament!' : `You finished ${ordinal(r.place)} of ${r.entrants}`}</h2>
        {t.cfg.satellite && <p className="small muted">{r.seat ? `You were one of the last ${t.paid} of ${r.entrants} players.` : `${t.paid} of ${r.entrants} players won seats.`}</p>}
        <div className="tiles">
          <Tile label={r.seat ? 'Seat value' : 'Prize'} value={fmtMoney(r.prize, r.currency)} sub={`${profit >= 0 ? 'profit' : 'loss'} ${fmtMoney(profit, r.currency)}`} />
          <Tile label="Hands" value={r.handsPlayed} sub={`reached ${STAGE_LABEL[r.stageReached].toLowerCase()}`} />
          <Tile label="Decisions" value={acc.scored ? `${Math.round(acc.pct)}%` : '–'} sub={`${acc.good}/${acc.scored} good or best`} />
        </div>
        {leaks.length > 0 && (
          <div className="stack">
            <span className="label">Biggest leaks this tournament</span>
            {leaks.map((l) => <div key={l.tag} className="small"><strong>{l.def.title}</strong> · {l.count}×{l.evLoss > 0 ? ` · ${l.evLoss.toFixed(1)}bb` : ''}</div>)}
          </div>
        )}
        <div className="row">
          <button className="btn primary" onClick={onNew}>New tournament</button>
          <button className="btn" onClick={() => { onNew(); nav({ page: 'analyze', tab: 'mistakes' }); }}>Review mistakes</button>
          <button className="btn ghost" onClick={() => { onNew(); nav({ page: 'home' }); }}>Home</button>
        </div>
      </div>
    </div>
  );
}

export { PROFILES };
