"""
Step 2 of the HandHQ research: where the data covers tournament-like spots, and what playing styles
the real (pseudonymous) players fall into.

  python3 research/handhq/styles.py <parsed-dir> <out-dir> [min_hands] [k]

Writes coverage.json (decisions by effective stack depth, antes and table size), styles.json
(k-means styles over HUD rates, with sizes and centroids) and player_styles.tsv (each player's
style), and prints a summary. Players are pseudonyms; only their style membership is kept.
"""
import json
import os
import sys

import numpy as np

FEATURES = [
    ('vpip', 'vpip', 'hands'),
    ('pfr', 'pfr', 'hands'),
    ('limp', 'limp', 'hands'),
    ('rfi', 'rfi', 'rfiOpp'),
    ('threeBet', 'threeBet', 'threeBetOpp'),
    ('foldTo3Bet', 'foldTo3Bet', 'foldTo3BetOpp'),
    ('bbFoldToSteal', 'bbFoldToSteal', 'bbVsStealOpp'),
    ('allinPre', 'allinPre', 'hands'),
]


def load_players(path):
    with open(path) as fh:
        header = fh.readline().rstrip('\n').split('\t')
        names, rows = [], []
        for line in fh:
            parts = line.rstrip('\n').split('\t')
            names.append(parts[0])
            rows.append([int(x) for x in parts[1:]])
    return names, header[1:], np.array(rows, dtype=np.float64)


def rates(cols, m):
    """Shrunk rates (add the population mean as a prior worth 10 chances) so small samples don't look extreme."""
    idx = {c: k for k, c in enumerate(cols)}
    out = []
    for _, num, den in FEATURES:
        x, n = m[:, idx[num]], m[:, idx[den]]
        mean = x.sum() / max(1.0, n.sum())
        out.append((x + 10 * mean) / (n + 10))
    out.append(m[:, idx['stackBBsum']] / np.maximum(1, m[:, idx['hands']]))
    return np.stack(out, axis=1)


def kmeans(x, k, seed=0, iters=100):
    rng = np.random.default_rng(seed)
    # k-means++ start
    c = [x[rng.integers(len(x))]]
    for _ in range(1, k):
        d = np.min(((x[:, None, :] - np.array(c)[None]) ** 2).sum(-1), axis=1)
        c.append(x[rng.choice(len(x), p=d / d.sum())])
    c = np.array(c)
    for _ in range(iters):
        lab = np.argmin(((x[:, None, :] - c[None]) ** 2).sum(-1), axis=1)
        new = np.array([x[lab == j].mean(0) if np.any(lab == j) else c[j] for j in range(k)])
        if np.allclose(new, c):
            break
        c = new
    inertia = ((x - c[lab]) ** 2).sum()
    return lab, c, inertia


def coverage(parsed):
    meta = json.load(open(os.path.join(parsed, 'decisions.json')))
    cols = meta['columns']
    d = np.memmap(os.path.join(parsed, 'decisions.bin'), dtype=np.int16, mode='r').reshape(-1, len(cols))
    eff = d[:, cols.index('eff10')] / 10
    ante = d[:, cols.index('ante10')] > 0
    n = d[:, cols.index('n')]
    action = d[:, cols.index('action')]
    shown = d[:, cols.index('cls')] >= 0
    bins = [0, 10, 15, 20, 30, 40, 60, 80, 120, 400]
    out = {'rows': int(len(d)), 'byEffBB': [], 'withAntes': int(ante.sum()), 'shownCards': int(shown.sum()),
           'byTableSize': {str(k): int((n == k).sum()) for k in range(3, 11) if (n == k).any()}}
    for lo, hi in zip(bins[:-1], bins[1:]):
        m = (eff >= lo) & (eff < hi)
        out['byEffBB'].append({'from': lo, 'to': hi, 'decisions': int(m.sum()), 'allins': int((m & (action == 4)).sum()),
                               'withAntes': int((m & ante).sum())})
    return out


def main():
    parsed, out = sys.argv[1], sys.argv[2]
    min_hands = int(sys.argv[3]) if len(sys.argv) > 3 else 300
    k = int(sys.argv[4]) if len(sys.argv) > 4 else 0
    os.makedirs(out, exist_ok=True)
    cov = coverage(parsed)
    json.dump(cov, open(os.path.join(out, 'coverage.json'), 'w'), indent=1)
    print(f"{cov['rows']:,} decisions; with antes {cov['withAntes']:,}; cards shown {cov['shownCards']:,}")
    for b in cov['byEffBB']:
        print(f"  eff {b['from']:>3}-{b['to']:<3}bb: {b['decisions']:>11,} decisions, {b['allins']:>9,} all-ins")

    names, cols, m = load_players(os.path.join(parsed, 'players.tsv'))
    keep = m[:, cols.index('hands')] >= min_hands
    r = rates(cols, m[keep])
    feat_names = [f[0] for f in FEATURES] + ['avgStackBB']
    # cluster on the behaviour rates (not stack size), standardised
    z = (r[:, :-1] - r[:, :-1].mean(0)) / r[:, :-1].std(0)
    print(f"{keep.sum():,} players with {min_hands}+ hands (of {len(names):,})")
    tried = {}
    for kk in ([k] if k else range(3, 11)):
        best = min((kmeans(z, kk, seed=s) for s in range(4)), key=lambda t: t[2])
        tried[kk] = best
        print(f"  k={kk}: within-style spread {best[2] / len(z):.3f}")
    if not k:
        # elbow: the first k where adding a style improves the fit by under 10%
        ks = sorted(tried)
        k = next((a for a, b in zip(ks, ks[1:]) if tried[b][2] > 0.9 * tried[a][2]), ks[-1])
    lab, _, _ = tried[k]
    styles = []
    for j in range(k):
        mask = lab == j
        cen = r[mask].mean(0)
        styles.append({'style': j, 'players': int(mask.sum()), 'hands': int(m[keep][mask, cols.index('hands')].sum()),
                       **{f: round(float(v), 3) for f, v in zip(feat_names, cen)}})
    styles.sort(key=lambda s: s['vpip'])
    order = {s['style']: i for i, s in enumerate(styles)}
    for i, s in enumerate(styles):
        s['style'] = i
    json.dump({'k': k, 'minHands': min_hands, 'features': feat_names, 'styles': styles}, open(os.path.join(out, 'styles.json'), 'w'), indent=1)
    with open(os.path.join(out, 'player_styles.tsv'), 'w') as fh:
        for name, j in zip(np.array(names)[keep], lab):
            fh.write(f"{name}\t{order[j]}\n")
    print(f"\n{k} styles (sorted by VPIP):")
    print('  #  players     hands  ' + '  '.join(f'{f[:8]:>8}' for f in feat_names))
    for s in styles:
        print(f"  {s['style']}  {s['players']:>7,} {s['hands']:>9,}  " + '  '.join(f"{s[f]:>8.3f}" if f != 'avgStackBB' else f"{s[f]:>8.0f}" for f in feat_names))


if __name__ == '__main__':
    main()
