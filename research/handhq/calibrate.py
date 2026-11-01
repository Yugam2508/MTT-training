"""
Calibrate how cleanly each style orders its hands. The data-fitted bots turn a frequency into a range
by taking the strongest hands; real players are noisier. Model: a player continues when
(hand strength position + noise) is below a threshold, noise ~ Normal(0, sigma), with the threshold set
so the style's measured frequency comes out. Fit sigma per style by maximum likelihood on hands shown
at all-ins: shoves (cards are shown when called, and being called doesn't depend on the shover's hand)
and calls of all-ins (both hands are shown). Other showdowns are biased towards strong hands, so they
are left out. Writes src/research/styleNoise.json.

  python3 research/handhq/calibrate.py <parsed-dir> <styles-dir> [freqs-json]
"""
import json
import math
import os
import sys

import numpy as np

EFF_BINS = [0, 10, 15, 20, 30, 40, 60, 100, 1000]
SIZE_BINS = [0, 2.6, 3.6, 1000]
SIGMAS = [0.005, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.1, 0.12, 0.15, 0.2, 0.25, 0.3, 0.4]
QBINS = 60


def norm_cdf(x):
    # Abramowitz-Stegun 7.1.26 erf, accurate to ~1e-7, vectorised
    z = np.asarray(x, dtype=np.float64) / math.sqrt(2)
    a = np.abs(z)
    t = 1 / (1 + 0.3275911 * a)
    y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * np.exp(-a * a)
    return 0.5 * (1 + np.sign(z) * y)


def main():
    parsed, styles_dir = sys.argv[1], sys.argv[2]
    freqs_path = sys.argv[3] if len(sys.argv) > 3 else 'src/research/styleFreqs.json'
    meta = json.load(open(os.path.join(parsed, 'decisions.json')))
    cols = meta['columns']
    c = {k: i for i, k in enumerate(cols)}
    d = np.memmap(os.path.join(parsed, 'decisions.bin'), dtype=np.int16, mode='r').reshape(-1, len(cols))
    pid = np.memmap(os.path.join(parsed, 'players.bin'), dtype=np.int64, mode='r')
    names = [line.split('\t', 1)[0] for line in open(os.path.join(parsed, 'players.tsv')).read().splitlines()[1:]]
    style_of = dict(line.split('\t') for line in open(os.path.join(styles_dir, 'player_styles.tsv')).read().splitlines())
    pstyle = np.array([int(style_of.get(n, -1)) for n in names], dtype=np.int8)
    F = json.load(open(freqs_path))
    freq = np.array(F['freq'])  # [style, facing, pos, eff, big, size, action]
    k = freq.shape[0]

    # hand strength position: share of combos stronger than the class, on the raw-equity ladder
    rank = np.load(os.path.join(os.path.dirname(__file__), 'hand_rank.npy'))
    order = np.argsort(rank, kind='stable')
    combos = np.array([6 if h // 13 == h % 13 else (4 if (h // 13) < (h % 13) else 12) for h in range(169)], dtype=np.float64) / 1326
    u = np.zeros(169)
    cum = 0.0
    for h in order:
        u[h] = cum + combos[h] / 2
        cum += combos[h]

    # shown hands at shoves / all-in calls, histogrammed by (style, kind, frequency bin, class)
    hist = np.zeros((k, 2, QBINS, 169), dtype=np.int64)
    step = 5_000_000
    for s in range(0, len(d), step):
        x = np.asarray(d[s:s + step])
        cls = x[:, c['cls']]
        sh = cls >= 0
        x, cls = x[sh], cls[sh]
        st = pstyle[np.asarray(pid[s:s + step])[sh]]
        ok = st >= 0
        x, cls, st = x[ok], cls[ok], st[ok]
        raises, limpers, act = x[:, c['raises']], x[:, c['limpers']], x[:, c['action']]
        tocall, stack, lastto = x[:, c['tocall10']], x[:, c['stack10']], x[:, c['lastto10']]
        facing = np.where(raises == 0, np.where(limpers > 0, 1, 0), np.where(raises == 1, 2, 3))
        facing = np.where((raises > 0) & (tocall >= stack * 0.6), 4, facing)
        eff = x[:, c['eff10']] / 10
        ebin = np.clip(np.searchsorted(EFF_BINS, eff, side='right') - 1, 0, len(EFF_BINS) - 2)
        big = (x[:, c['n']] >= 7).astype(np.int64)
        sbin = np.where(facing == 2, np.clip(np.searchsorted(SIZE_BINS, lastto / 10, side='right') - 1, 0, len(SIZE_BINS) - 2), 0)
        cell = freq[st, facing, x[:, c['pos']], ebin, big, sbin]
        shove = (act == 4) & (facing != 4)
        callai = (facing == 4) & (act >= 2)
        # the band the bot would take these from: raise+allin for a shove, call+raise+allin facing an all-in
        q = np.where(shove, cell[:, 2] + cell[:, 3], cell[:, 1] + cell[:, 2] + cell[:, 3])
        kind = np.where(shove, 0, 1)
        m = shove | callai
        qb = np.clip((q[m] * QBINS).astype(np.int64), 0, QBINS - 1)
        np.add.at(hist, (st[m], kind[m], qb, cls[m]), 1)
        print(f'{min(s + step, len(d)):,}/{len(d):,}', flush=True)

    def threshold(qv, sigma):
        lo, hi = -1.0, 2.0
        for _ in range(50):
            t = (lo + hi) / 2
            if (combos * norm_cdf((t - u) / sigma)).sum() < qv:
                lo = t
            else:
                hi = t
        return (lo + hi) / 2

    out = {'sigma': [], 'byKind': [], 'grid': SIGMAS, 'shown': hist.sum(axis=(2, 3)).tolist()}
    for j in range(k):
        best_by_kind = []
        total = np.zeros(len(SIGMAS))
        for kk in range(2):
            ll = np.zeros(len(SIGMAS))
            for b in range(QBINS):
                n = hist[j, kk, b]
                if n.sum() == 0:
                    continue
                qv = (b + 0.5) / QBINS
                for si, sigma in enumerate(SIGMAS):
                    t = threshold(qv, sigma)
                    p = combos * norm_cdf((t - u) / sigma)
                    p = np.maximum(p / p.sum(), 1e-12)
                    ll[si] += (n * np.log(p)).sum()
            total += ll
            best_by_kind.append(SIGMAS[int(np.argmax(ll))])
        out['sigma'].append(SIGMAS[int(np.argmax(total))])
        out['byKind'].append(best_by_kind)
        # how the mean strength position of shown hands compares with clean ordering and with the fit
        print(f'style {j}: best sigma {out["sigma"][-1]} (shoves {best_by_kind[0]}, all-in calls {best_by_kind[1]}), shown {hist[j].sum():,}')
    json.dump(out, open('src/research/styleNoise.json', 'w'))
    print('wrote src/research/styleNoise.json')


if __name__ == '__main__':
    main()
