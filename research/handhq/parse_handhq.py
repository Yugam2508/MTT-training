"""
Parse the HandHQ 2009 online no-limit hold'em hands (PHH format, uoftcprg/phh-dataset) into:

  players.tsv     one row per pseudonymous player: hands seen and the counts behind the usual HUD
                  stats (VPIP, PFR, limp, RFI, 3-bet, fold to 3-bet, BB fold to steal), stack depth.
  decisions.bin   one row per preflop decision (int16 columns, see COLUMNS), for fitting models.
  decisions.json  column names, scales and row count.

Players are only pseudonyms (the dataset is obfuscated), and nothing here tries to identify anyone:
the research uses them as a population, to learn playing styles.

  python3 research/handhq/parse_handhq.py <phh-dataset>/data/handhq <out-dir> [workers]
"""
import json
import math
import os
import re
import sys
from array import array
from multiprocessing import Pool

# Chart positions by seats clockwise from the button (matches src/theory/positions.ts)
NON_BLIND_BY_DIST = ['BTN', 'CO', 'HJ', 'LJ', 'UTG2', 'UTG1', 'UTG']
POSITIONS = ['UTG', 'UTG1', 'UTG2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB']


def chart_position(n, offset):
    if offset == 1:
        return 'SB'
    if offset == 2:
        return 'BB'
    if offset == 0:
        return 'BTN'
    return NON_BLIND_BY_DIST[min(n - offset, len(NON_BLIND_BY_DIST) - 1)]


RANKS = '23456789TJQKA'


def hand_class(cards):
    """169-class index matching src/engine/combos.ts: row = 12 - high rank; pairs on the diagonal,
    suited above it (row < col), offsuit below."""
    if len(cards) != 4 or '?' in cards:
        return -1
    r1, s1, r2, s2 = RANKS.find(cards[0]), cards[1], RANKS.find(cards[2]), cards[3]
    if r1 < 0 or r2 < 0:
        return -1
    hi, lo = max(r1, r2), min(r1, r2)
    a, b = 12 - hi, 12 - lo
    if hi == lo:
        return a * 13 + a
    return a * 13 + b if s1 == s2 else b * 13 + a


# decision columns (int16). BB amounts are stored x10, capped at 3000 (300bb).
COLUMNS = [
    'player',      # filled from a separate int32 file (player index); placeholder 0 here
    'site', 'n', 'pos', 'stack10', 'eff10', 'ante10',
    'raises', 'limpers', 'callers', 'tocall10', 'lastto10', 'pot10',
    'hero_raised', 'action', 'to10', 'cls',
]
ACTIONS = ['fold', 'check', 'call', 'raise', 'allin']
SITES = ['ABS', 'FTP', 'IPN', 'ONG', 'PS', 'PTY']

LIST_RE = re.compile(r"^(\w+) = \[(.*)\]$")


def bb10(x, bb):
    return max(-32000, min(3000, int(round(10 * x / bb))))


STAT_KEYS = ['hands', 'vpip', 'pfr', 'limp', 'rfiOpp', 'rfi', 'threeBetOpp', 'threeBet',
             'foldTo3BetOpp', 'foldTo3Bet', 'bbVsStealOpp', 'bbFoldToSteal', 'allinPre', 'stackBBsum']


def parse_hand(h, site, stats, rows, pids, pid_of):
    try:
        stacks = [float(x) for x in h['starting_stacks']]
        blinds = [float(x) for x in h['blinds_or_straddles']]
        antes = [float(x) for x in h.get('antes', ['0'] * len(stacks))]
        players = [p.strip().strip("'") for p in h['players']]
        actions = [a.strip().strip("'") for a in h['actions']]
    except (KeyError, ValueError):
        return
    if not all(math.isfinite(x) and x >= 0 for x in stacks + blinds + antes):
        return  # a few records have corrupt amounts
    n = len(stacks)
    if n < 3 or len(players) != n or len(blinds) < 2 or blinds[1] <= 0 or any(b > 0 for b in blinds[2:]):
        return  # heads-up and straddled hands are left out
    bb = blinds[1]
    ante_total = sum(antes)
    committed = [blinds[i] if i < 2 else 0.0 for i in range(n)]
    committed = [min(c, stacks[i] - antes[i]) for i, c in enumerate(committed)]
    folded = [False] * n
    acted = [False] * n
    keys = [site + ':' + p for p in players]
    for k in keys:
        if k not in stats:
            stats[k] = [0] * len(STAT_KEYS)
    shown = {}
    raises = limpers = callers = 0
    last_to = bb
    opener = -1
    raisers = []
    flags = [dict() for _ in range(n)]
    hand_rows = []
    preflop = True
    for a in actions:
        parts = a.split()
        if parts[0] == 'd':
            if len(parts) > 1 and parts[1] == 'db':
                preflop = False
            continue
        if not parts[0].startswith('p'):
            continue
        i = int(parts[0][1:]) - 1
        code = parts[1] if len(parts) > 1 else ''
        if code == 'sm' and len(parts) > 2:
            shown[i] = hand_class(parts[2])
            continue
        if not preflop or i < 0 or i >= n:
            continue
        chips = stacks[i] - antes[i]
        max_other = max((stacks[j] - antes[j] for j in range(n) if j != i and not folded[j]), default=0)
        to_call = max(0.0, last_to - committed[i])
        pot = ante_total + sum(committed)
        offset = (i + 1) % n
        pos = chart_position(n, offset)
        f = flags[i]
        unopened = raises == 0
        if unopened and limpers == 0:
            f['rfiOpp'] = 1
            if pos in ('CO', 'BTN', 'SB'):
                f['stealOpp'] = 1
        if raises == 1 and not acted[i] and i != opener:
            f['threeBetOpp'] = 1
        if raises == 2 and i == opener and len(raisers) >= 2:
            f['foldTo3BetOpp'] = 1
        if pos == 'BB' and raises == 1 and limpers == 0 and callers == 0 and opener >= 0 and chart_position(n, (opener + 1) % n) in ('CO', 'BTN', 'SB'):
            f['bbVsStealOpp'] = 1
        if code not in ('f', 'cc', 'cbr'):
            continue
        # the situation as the player saw it, before their action
        pre = [SITES.index(site), n, POSITIONS.index(pos), bb10(chips, bb), bb10(min(chips, max_other), bb),
               bb10(ante_total, bb), min(raises, 9), min(limpers, 9), min(callers, 9), bb10(to_call, bb), bb10(last_to, bb),
               bb10(pot, bb), 1 if i in raisers else 0]
        if code == 'f':
            act, to = 0, 0.0
            folded[i] = True
            if f.get('foldTo3BetOpp'):
                f['foldTo3Bet'] = 1
            if f.get('bbVsStealOpp'):
                f['bbFoldToSteal'] = 1
        elif code == 'cc':
            if to_call <= 1e-9:
                act, to = 1, committed[i]
            else:
                act, to = 2, min(chips, last_to)
                f['vpip'] = 1
                if unopened:
                    f['limp'] = 1
                    limpers += 1
                else:
                    callers += 1
                if to >= chips - 1e-9:
                    f['allin'] = 1
            committed[i] = to
        elif code == 'cbr' and len(parts) > 2:
            try:
                to = min(chips, float(parts[2]))
            except ValueError:
                return
            if not math.isfinite(to):
                return
            act = 4 if to >= chips - 1e-9 else 3
            f['vpip'] = 1
            f['pfr'] = 1
            if act == 4:
                f['allin'] = 1
            if unopened and limpers == 0:
                f['rfi'] = 1
            if f.get('threeBetOpp') and raises == 1:
                f['threeBet'] = 1
            raises += 1
            if opener < 0:
                opener = i
            raisers.append(i)
            last_to = max(last_to, to)
            callers = 0
            committed[i] = to
        else:
            continue
        hand_rows.append([0] + pre + [act, bb10(to, bb), i])
        acted[i] = True
    for i in range(n):
        s = stats[keys[i]]
        s[0] += 1
        f = flags[i]
        for k, name in enumerate(STAT_KEYS[1:-2], start=1):
            if f.get(name):
                s[k] += 1
        if f.get('allin'):
            s[12] += 1
        s[13] += min(300, int(round((stacks[i] - antes[i]) / bb)))
    for r in hand_rows:
        i = r[-1]
        r[-1] = shown.get(i, -1)
        rows.extend(r[1:])
        k = keys[i]
        pid = pid_of.get(k)
        if pid is None:
            pid = pid_of[k] = len(pid_of)
        pids.append(pid)


def parse_file(path, site, stats, rows, pids, pid_of):
    h = {}
    with open(path, encoding='utf-8', errors='replace') as fh:
        for line in fh:
            line = line.rstrip('\n')
            if line.startswith('['):
                if h:
                    parse_hand(h, site, stats, rows, pids, pid_of)
                h = {}
                continue
            m = LIST_RE.match(line)
            if m:
                h[m.group(1)] = [x for x in m.group(2).split(', ')] if m.group(2) else []
        if h:
            parse_hand(h, site, stats, rows, pids, pid_of)


def work(job):
    k, files, out = job
    stats, rows, pids, pid_of = {}, array('h'), array('l'), {}
    for site, path in files:
        parse_file(path, site, stats, rows, pids, pid_of)
    with open(os.path.join(out, f'part{k:03d}.bin'), 'wb') as fh:
        rows.tofile(fh)
    names = [None] * len(pid_of)
    for name, i in pid_of.items():
        names[i] = name
    return k, stats, names, list(pids), len(rows) // (len(COLUMNS) - 1)


def main():
    src, out = sys.argv[1], sys.argv[2]
    workers = int(sys.argv[3]) if len(sys.argv) > 3 else os.cpu_count()
    os.makedirs(out, exist_ok=True)
    files = []
    for d in sorted(os.listdir(src)):
        site = d.split('-')[0]
        if site not in SITES:
            continue
        for root, _, names in os.walk(os.path.join(src, d)):
            files += [(site, os.path.join(root, f)) for f in names if f.endswith('.phhs')]
    chunk = 40
    jobs = [(k, files[s:s + chunk], out) for k, s in enumerate(range(0, len(files), chunk))]
    print(f'{len(files)} files in {len(jobs)} jobs', flush=True)
    stats, index, total = {}, {}, 0
    with open(os.path.join(out, 'decisions.bin'), 'wb') as dec, open(os.path.join(out, 'players.bin'), 'wb') as pfile, Pool(workers) as pool:
        for done, (k, st, names, pids, nrows) in enumerate(pool.imap(work, jobs), 1):
            for name, s in st.items():
                acc = stats.setdefault(name, [0] * len(STAT_KEYS))
                for j, x in enumerate(s):
                    acc[j] += x
            local = [index.setdefault(name, len(index)) for name in names]
            array('l', [local[p] for p in pids]).tofile(pfile)
            part = os.path.join(out, f'part{k:03d}.bin')
            with open(part, 'rb') as fh:
                dec.write(fh.read())
            os.remove(part)
            total += nrows
            if done % 20 == 0 or done == len(jobs):
                print(f'{done}/{len(jobs)} jobs, {total} decisions, {len(stats)} players', flush=True)
    with open(os.path.join(out, 'players.tsv'), 'w') as fh:
        fh.write('player\t' + '\t'.join(STAT_KEYS) + '\n')
        for name in sorted(index, key=index.get):
            fh.write(name + '\t' + '\t'.join(str(x) for x in stats[name]) + '\n')
    with open(os.path.join(out, 'decisions.json'), 'w') as fh:
        json.dump({'columns': COLUMNS[1:], 'dtype': 'int16', 'rows': total, 'player_index': 'players.bin (int64 per row, index into players.tsv rows)',
                   'actions': ACTIONS, 'positions': POSITIONS, 'sites': SITES, 'bb_scale': 10}, fh, indent=1)
    print('done', total, 'decisions,', len(stats), 'players')


if __name__ == '__main__':
    main()
