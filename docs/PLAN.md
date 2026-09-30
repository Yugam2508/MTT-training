# MTT Coach: build plan

Goal: a self-contained trainer for multi-table poker tournaments (NLHE) that helps a player
cash more often and convert deep runs into wins. Three pillars:

1. **Play**: realistic MTT simulations (full field, multiple tables, rising blinds with BB ante,
   table breaking/balancing, bubble, pay jumps, final table) against distinct opponent types.
2. **Analyze**: every hero decision is graded by a coach; stats and leak detection across sessions.
3. **Learn**: theory lessons with quizzes, targeted drills, stage-by-stage strategy playbooks, tools.

## Tech choices (and why)

| Choice | Reason |
| --- | --- |
| TypeScript + React 18 + Vite | Runs entirely in the browser: no server, instant start, easy to host anywhere. React 18 because it ships UMD builds (needed for the single-file build). |
| Vitest | Engine correctness (side pots, min-raise rules, ICM) is tested before any UI is built on top. |
| localStorage persistence | Hand histories, graded decisions, drill and lesson progress stay on the user's machine. Export/import JSON for backup. |
| Precomputed 169x169 preflop equity matrix | Makes push/fold and ICM solving fast enough to run live during play (ms, not seconds). |
| No UI/chart libraries | Hand-built SVG/CSS keeps the bundle small and avoids dependency churn. |

## Module layout (dependency order = build order)

```
src/engine      rng, cards, 7-card evaluator, combos/ranges, Monte Carlo equity, NLHE hand state machine
src/theory      ICM (exact + Monte Carlo), payouts, push/fold solver (chip EV or ICM), preflop charts, positions
src/bots        opponent profiles, board-strength tables, action policies (as probability distributions)
src/tournament  blind structures, field generation, multi-table manager (balancing, breaking, eliminations)
src/coach       Bayesian range estimation from bot policies, decision grader, live hints
src/analysis    per-hand stat flags, aggregate stats, leak detection rules
src/content     lessons + quizzes, strategy playbooks, glossary
src/drills      spot generators for push/fold, call-vs-shove, ICM bubble, opening, defending, pot odds
src/store       persistence (localStorage) + export/import
src/ui          pages: Dashboard, Play, Train, Learn, Strategy, Analyze, Tools
```

## Key design decisions (made up front to avoid rework)

- **Engine is a pure state machine** (`createHand`, `legalActions`, `applyAction`). Hands are replayable
  from (seat list, deck order, action list), so the review screen can rebuild any decision point.
- **Bots expose policies as probability distributions**, not just sampled actions. The same function
  lets the coach compute P(action | hand) and filter an opponent's range by Bayes' rule. The coach
  never looks at hidden cards; it grades against the range a player could hold.
- **One push/fold solver for chip EV and ICM**: outcome stack vectors are valued once
  (chips, or ICM $ equity), then fictitious play finds push and call ranges. Used by bots,
  the grader, the chart tool and the drills.
- **ICM**: exact Malmuth-Harville DP when the state space is small, Plackett-Luce Monte Carlo
  with common random numbers otherwise (full-field ICM near the bubble in large MTTs).
- **Tournament runs hand-for-hand**: each hero hand, every other table plays one hand instantly.
  This keeps eliminations, table moves and the bubble realistic.
- **Grades** (`best / good / inaccuracy / mistake / blunder / unscored`) carry an EV loss in big blinds
  where it can be computed (all-ins, river calls) and a range-distance severity otherwise
  (preflop chart deviations). Postflop bet/check spots are only graded when clear-cut.

## Milestones

1. Scaffold, engine + tests (evaluator, side pots, betting rules)
2. Preflop equity matrix generator, ICM, payouts, push/fold solver + tests (compare to known HU Nash)
3. Preflop charts, bot profiles and policies, tournament manager + headless full-MTT simulation test
4. Coach (range estimation, grader, hints), stats, leak detection
5. Content: lessons, quizzes, playbooks; drills
6. UI for all sections, persistence, single-file build; browser smoke test
