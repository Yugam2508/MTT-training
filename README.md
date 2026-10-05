# MTT Coach

A trainer for multi-table poker tournaments (No-Limit Hold'em). It is built to help you cash
more often and convert deep runs into wins:

- **Play** realistic tournaments: full fields (27–180 players) on multiple tables, rising blinds
  with a big-blind ante, table breaks and balancing, a hand-for-hand bubble, pay jumps and a final
  table. Opponents are seven distinct player types (winning reg, TAG, LAG, nit, calling station,
  recreational, maniac) mixed by stake level. Scenario starts drop you straight into the middle
  stages, the bubble or the final table. Satellite formats (the SPC Main Event satellite: S$60,
  10 seats of S$600) pay equal seats and stop once every remaining player has one.
- **Get coached** on every decision. Preflop all-ins (open-shoves, re-shoves, calling shoves) are
  solved with the real stacks in chip EV or, near the money, full-field ICM $EV. Other preflop
  spots are compared to baseline charts. Postflop calls and folds are checked against pot odds and
  your equity versus the opponent's range, estimated with Bayes' rule from how that opponent
  actually plays. The coach never peeks at hidden cards.
- **Analyze** your patterns: HUD-style stats vs winning MTT ranges (VPIP, PFR, steal, 3-bet,
  fold to 3-bet, BB defence, c-bet, WTSD…), opening frequency by position, accuracy by stage and
  spot type, a ranked list of leaks with examples, every mistake with its cost, and a step-by-step
  hand replayer.
- **Learn** the theory: 13 lessons (ICM, satellites, push/fold, stack depth, pot odds, c-betting, value and
  bluffing, final tables, exploits, bankroll) with quizzes, stage-by-stage strategy playbooks and
  a guide to beating each player type.
- **Train** with six drills: push or fold, call vs shove, ICM bubble calls, opening ranges,
  facing opens, pot odds and outs.
- **Tools**: range charts, Nash push/fold charts, an equity calculator and an ICM calculator.

Live at **https://mtt-coach.vercel.app**. The trainer runs in the browser: progress, hand
histories and graded decisions are kept in localStorage, so it works offline and without an
account. Create a free account (Account page) to back that data up and sync it across devices.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
```

Other scripts:

| Command | What it does |
| --- | --- |
| `npm test` | Unit and simulation tests (engine, solver, ICM, full tournaments, coach, drills) |
| `npm run typecheck` | TypeScript checks |
| `npm run build` | Production build to `dist/` (static files, host anywhere) |
| `npm run build:single` | One self-contained HTML page in `dist-single/standalone.html` (React from cdnjs) |
| `npm run gen:equity` | Regenerate the 169×169 preflop equity matrix (~1 min) |
| `npm run gen:charts` | Regenerate the precomputed Nash push/fold charts (~20 s) |

## Accounts and cloud sync

```
browser (Vercel, static)  ──HTTPS──▶  Supabase Edge Function `mtt-api`  ──▶  Postgres table `app_storage`
```

- **API** (`supabase/functions/mtt-api/app.ts`): register, sign in, change password, delete
  account, and get/put one data blob per account. Passwords are hashed with scrypt; sessions are
  HMAC-signed tokens that a password change revokes. Writes use ETags, so two devices can't
  overwrite each other.
- **Storage** (`supabase/migrations/`): one private table with row-level security on and no
  policies, so only the function (using the project's secret key) can read or write it.
- **Client** (`src/cloud/`): localStorage stays the working copy. Sync pulls, merges and pushes in
  the background (a few seconds after changes, and on sign-in). The merge is order-independent:
  hands and decisions are unioned by id, and drill and stat counters are kept per device, so
  practice done offline on two devices adds up instead of being lost.

Local development needs no Supabase: `npm run dev` and `npm run preview` serve the same API at
`/api/main`, stored in `.data/`. To point a build at a different API, set `VITE_API_URL`.

Deploying the backend with the Supabase CLI:

```bash
supabase link --project-ref tyjicebieaojrtedjpnx
supabase db push                              # applies supabase/migrations
supabase functions deploy mtt-api --no-verify-jwt
```

The site is a static Vite build (`npm run build` → `dist/`); Vercel builds it from this repo.

## How it works

See [docs/PLAN.md](docs/PLAN.md) for the design. In short:

```
src/engine      cards, 7-card evaluator, ranges, Monte Carlo/exact equity, NLHE hand state machine
src/theory      ICM (exact bitmask DP + Plackett-Luce Monte Carlo), payouts, push/fold solver, charts
src/bots        opponent profiles and policies (probability distributions over actions)
src/tournament  blind structures, presets, multi-table manager (balancing, breaks, busts, resume)
src/coach       Bayesian range estimation, advice and grading
src/analysis    per-hand stat flags, aggregate stats, leak detection
src/content     lessons, quizzes, playbooks
src/drills      drill generators
src/ui          React UI
src/cloud       accounts, background sync, order-independent merge
supabase        Edge Function (cloud API) and database migration
server          local copy of the API for the Vite dev/preview server
```

Key choices:

- **One solver for chip EV and ICM.** The push/fold solver works on the *values* of the possible
  outcomes (fold, steal, win or lose against each caller), so feeding it chip stacks gives chip EV
  and feeding it ICM equities gives $EV. Bots use precomputed Nash charts (fast); the coach solves
  your exact spot.
- **Bots expose distributions, not just actions.** That lets the coach compute
  P(action | hand) for every combo and narrow an opponent's range the way a strong player would.
- **Hand-for-hand simulation.** Each time you play a hand, every other table plays one hand
  instantly, so eliminations, table moves and the bubble happen at realistic times.

## Grades

| Grade | Meaning |
| --- | --- |
| Best | The highest-EV option, or the chart's main play |
| Good | Close to best (≤ 0.25bb) or a legitimate mixed play |
| Inaccuracy | Small loss (≤ 0.75bb) or a low-frequency deviation |
| Mistake | Clear loss (≤ 2.5bb) or well outside the range |
| Blunder | Large loss, or folding a premium / playing a hand far outside the range |

ICM losses are converted to big-blind equivalents using your stack's average $ value per big blind.
Charts and baseline ranges are sound simplified defaults for 9-handed MTTs with a big-blind ante,
not exact solver output.
