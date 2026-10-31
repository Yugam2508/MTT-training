"""
Step 3 of the HandHQ research: how often each data-driven style folds, calls, raises and shoves
preflop, by situation. Writes src/research/styleFreqs.json for the simulator's data-driven bots.

  python3 research/handhq/fit_styles.py <parsed-dir> <styles-dir> [out-json]

Situations: what the player faces (unopened, limped, one raise, a 3-bet or more, an all-in), their
position, their effective stack and the table size; facing a raise also by its size. Cells with few
decisions borrow from the same situation pooled over table sizes, then over positions (shrinkage).
Shown hands (only at showdown, so biased towards stronger hands) give a check on how strong each
style's continuing hands are: the mean hand rank of shown calls and raises per style and situation.
"""
import json
import os
import sys

import numpy as np

EFF_BINS = [0, 10, 15, 20, 30, 40, 60, 100, 1000]
POS = ['UTG', 'UTG1', 'UTG2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB']
FACING = ['unopened', 'limped', 'raise', 'reraise', 'allin']
# facing a single raise: its size in bb
SIZE_BINS = [0, 2.6, 3.6, 1000]
ACTIONS = ['fold', 'call', 'raise', 'allin']   # check counts as fold (passive, no money in) when unopened from the BB
PRIOR = 30.0


def main():
    parsed, styles_dir = sys.argv[1], sys.argv[2]
    out = sys.argv[3] if len(sys.argv) > 3 else 'src/research/styleFreqs.json'
    meta = json.load(open(os.path.join(parsed, 'decisions.json')))
    cols = meta['columns']
    c = {k: i for i, k in enumerate(cols)}
    d = np.memmap(os.path.join(parsed, 'decisions.bin'), dtype=np.int16, mode='r').reshape(-1, len(cols))
    pid = np.memmap(os.path.join(parsed, 'players.bin'), dtype=np.int64, mode='r')
    # player index -> style (-1 = too few hands to classify)
    names = [line.split('\t', 1)[0] for line in open(os.path.join(parsed, 'players.tsv')).read().splitlines()[1:]]
    style_of = dict(line.split('\t') for line in open(os.path.join(styles_dir, 'player_styles.tsv')).read().splitlines())
    pstyle = np.array([int(style_of.get(n, -1)) for n in names], dtype=np.int8)
    k = int(json.load(open(os.path.join(styles_dir, 'styles.json')))['k'])

    counts = np.zeros((k, len(FACING), len(POS), len(EFF_BINS) - 1, 2, len(SIZE_BINS) - 1, len(ACTIONS)), dtype=np.int64)
    rank_sum = np.zeros((k, len(FACING), len(ACTIONS)), dtype=np.float64)
    rank_n = np.zeros((k, len(FACING), len(ACTIONS)), dtype=np.int64)
    hand_rank = np.load(os.path.join(os.path.dirname(__file__), 'hand_rank.npy')) if os.path.exists(os.path.join(os.path.dirname(__file__), 'hand_rank.npy')) else None

    step = 5_000_000
    for s in range(0, len(d), step):
        x = np.asarray(d[s:s + step])
        st = pstyle[np.asarray(pid[s:s + step])]
        keep = st >= 0
        x, st = x[keep], st[keep]
        raises, limpers, act = x[:, c['raises']], x[:, c['limpers']], x[:, c['action']]
        tocall, stack, lastto = x[:, c['tocall10']], x[:, c['stack10']], x[:, c['lastto10']]
        facing = np.where(raises == 0, np.where(limpers > 0, 1, 0), np.where(raises == 1, 2, 3))
        # facing an all-in: the amount to call covers (nearly) the player's stack, or the last raise was a shove
        facing = np.where((raises > 0) & (tocall >= stack * 0.6), 4, facing)
        a = np.select([act <= 1, act == 2, act == 3, act == 4], [0, 1, 2, 3])
        eff = x[:, c['eff10']] / 10
        ebin = np.clip(np.searchsorted(EFF_BINS, eff, side='right') - 1, 0, len(EFF_BINS) - 2)
        big = (x[:, c['n']] >= 7).astype(np.int64)
        sbin = np.where(facing == 2, np.clip(np.searchsorted(SIZE_BINS, lastto / 10, side='right') - 1, 0, len(SIZE_BINS) - 2), 0)
        idx = np.ravel_multi_index((st, facing, x[:, c['pos']], ebin, big, sbin, a), counts.shape)
        counts += np.bincount(idx, minlength=counts.size).reshape(counts.shape)
        if hand_rank is not None:
            cls = x[:, c['cls']]
            sh = cls >= 0
            np.add.at(rank_sum, (st[sh], facing[sh], a[sh]), hand_rank[cls[sh]])
            np.add.at(rank_n, (st[sh], facing[sh], a[sh]), 1)
        print(f'{min(s + step, len(d)):,}/{len(d):,}', flush=True)

    # shrink each cell towards the same situation pooled over table size, then over position
    pooled_t = counts.sum(axis=4, keepdims=True)
    pooled_p = counts.sum(axis=(2, 4), keepdims=True)
    def norm(v):
        return v / np.maximum(1, v.sum(-1, keepdims=True))
    base_p = norm(pooled_p.astype(np.float64))
    base_t = (pooled_t + PRIOR * base_p) / np.maximum(1e-9, pooled_t.sum(-1, keepdims=True) + PRIOR)
    freq = (counts + PRIOR * base_t) / (counts.sum(-1, keepdims=True) + PRIOR)
    styles = json.load(open(os.path.join(styles_dir, 'styles.json')))
    result = {
        'source': 'HandHQ 2009 online NLHE (uoftcprg/phh-dataset), pseudonymous players with 300+ hands',
        'styles': styles['styles'],
        'axes': {'style': list(range(k)), 'facing': FACING, 'pos': POS, 'effBB': EFF_BINS, 'tableSize': ['<=6', '7+'],
                 'raiseSizeBB': SIZE_BINS, 'action': ACTIONS},
        'freq': np.round(freq, 4).tolist(),
        'n': counts.sum(-1).tolist(),
    }
    if hand_rank is not None:
        result['shownRank'] = np.round(rank_sum / np.maximum(1, rank_n), 3).tolist()
        result['shownN'] = rank_n.tolist()
    json.dump(result, open(out, 'w'), separators=(',', ':'))
    print('wrote', out, os.path.getsize(out), 'bytes')
    # a readable slice: opening (unopened) raise+allin frequency by position at 20-30bb and 100bb, 9-max
    for e, label in [(4, '20-30bb'), (7, '100bb+')]:
        print(f'\nopen frequency, unopened, full ring, {label}:')
        print('style ' + ' '.join(f'{p:>5}' for p in POS[:-1]))
        for j in range(k):
            print(f'{j:>5} ' + ' '.join(f'{100 * (freq[j, 0, pi, e, 1, 0, 2] + freq[j, 0, pi, e, 1, 0, 3]):5.1f}' for pi in range(len(POS) - 1)))
    print('\nshove frequency facing nothing (unopened), by stack, BTN, full ring:')
    for j in range(k):
        print(f'{j:>5} ' + ' '.join(f'{EFF_BINS[b]:>3}+:{100 * freq[j, 0, 6, b, 1, 0, 3]:5.1f}' for b in range(len(EFF_BINS) - 1)))
    print('\ncall frequency facing an all-in, BB, full ring, by stack:')
    for j in range(k):
        print(f'{j:>5} ' + ' '.join(f'{EFF_BINS[b]:>3}+:{100 * freq[j, 4, 8, b, 1, 0, 1]:5.1f}' for b in range(len(EFF_BINS) - 1)))


if __name__ == '__main__':
    main()
