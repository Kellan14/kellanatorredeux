# Automatic doubles scoring preview

The preview is off by default. Set the server environment variable
`STRATEGY_ASSIGNMENT_PREVIEW=true` in a test deployment to show the opt-in
checkbox in Strategy → Generate Doubles. Leave it unset to keep legacy scoring
and hide the preview. Existing reports, singles, slider preferences, and
default scoring are unchanged.

Both generators use the frozen log-normalized model and the selected history
window, including history on machines outside the venue's candidate list.
Automatic ranking uses own-team estimates only; opponent and POPS metrics
remain descriptive comparisons, not terms in the objective. The optional
minimum machine history defaults to zero.

The preview uses four distinct candidate machine keys, eight assignments,
and up to four bench slots. It respects selected availability, must-play
players, machine exclusions and player-machine exclusions. Forced placements
are supported by the preview API via `forcedAssignments`; Generate Doubles
does not currently expose a separate forcing control. Candidate keys and
availability come from the Strategy selection. It does not discover multiple
rulesets on a single physical cabinet or determine match-wide bonus eligibility.

The search is limited to 4–32 machines, 8–12 available players, up to eight
seasons, and at most 20 returned lineups. Hungarian solves the additive
objective for each candidate machine set; Greedy uses a feasibility check
before accepting an edge. The alternative list includes different machine
sets and some nearby pairings, not an exhaustive top-k enumeration.
Per-player alternatives hold the four machines fixed and remove both slots
on the selected machine. A positive Greedy delta can occur when the
constraint makes the heuristic find a stronger arrangement.

Cold requests paginate league history with at most four season reads in
parallel. A worker retains up to four estimators for two minutes, keyed by
season range, model version, current score limits, and a shared history
revision. Game sync, machine-canon updates, and name/integrity corrections
invalidate the revision. Changes made directly in the database are picked up
when the short worker entry expires; score limits are checked on every
request. Roster choices and lineup results are not cached. The selected season
range and model version accompany the response. Model score differences are
not projected match points or statistical confidence intervals.

## Verification and remaining rollout gates

- `npx tsc --noEmit`
- `node --import ./scripts/strategy/lib/register-alias.mjs scripts/test-assignment-estimator.mjs`
- `node --import ./scripts/strategy/lib/register-alias.mjs scripts/test-normalization-api.mjs`
- `node --experimental-strip-types scripts/test-ranked-doubles.mjs`
- `node --experimental-strip-types scripts/test-assignment-history-cache.mjs`
- The archived TWC snapshot reproduced both prior Hungarian results (zero
  and three minimum games) across 14,950 machine sets. A separate local
  invocation against current league history returned five valid lineups.
- The real Next.js development runtime returned identical lineups in 2.34 s
  cold and 0.39/0.37 s warm after bounded parallel reads. These timings exclude
  the separate metric comparison and are not production guarantees.
- At 390 px, the preview generated five lineups, displayed metric comparisons
  and expanded assignment tradeoffs, and had no horizontal overflow.
- The frozen shared estimator reproduced all 17,355 retrospective predictions
  in seasons 22–24 with maximum absolute difference below 1e-15. It reduced
  mean squared log-score prediction error by 1.88% versus the original
  overall-strength model. This is parity on previously studied data, not new
  prospective evidence or an estimate of match-point gains.

Before changing defaults: test on the deployment, and migrate the main Strategy
controls and reports so the mode and scoring basis are explicit everywhere.
Do not automatically apply this doubles model to singles or custom scoring.
