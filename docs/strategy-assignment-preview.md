# Automatic lineup scoring preview

The preview is off by default. Set the server environment variable
`STRATEGY_ASSIGNMENT_PREVIEW=true` in a test deployment to show the opt-in
checkbox in Strategy and Generate Doubles. Leave it unset to keep legacy
scoring and hide automatic mode. The two controls share one saved preference.
In automatic mode, Optimize Doubles Picks opens the automatic generator and
Create Report uses one four-machine automatic lineup per method, including
model version and evidence. Report failures are explicit, never substituted
with manual picks. Opponent-pick response and advanced manual optimization
retain their existing scoring.

Generate Singles uses the same workflow for seven players and seven distinct
machines. Manual remains the singles default. With the preview flag enabled,
automatic singles is a separate opt-in, also used by Create Report. It applies
the doubles-calibrated estimator experimentally; it has not been validated
on singles outcomes.

After deployment verification, setting `STRATEGY_ASSIGNMENT_DEFAULT=automatic`
can default new/unset preferences to automatic when the preview is enabled.
Explicit manual preferences still win. Unsetting the preview flag is the
rollback. Neither flag is changed by this commit.

Both generators use the frozen log-normalized model and the selected history
window, including history on machines outside the venue's candidate list.
Automatic ranking uses own-team estimates only; opponent and POPS metrics
remain descriptive comparisons, not terms in the objective. The optional
minimum machine history defaults to zero.

The preview uses four distinct candidate machine keys, eight assignments,
and up to four bench slots. It respects selected availability, must-play
players, machine exclusions and player-machine exclusions. Click player or
machine names to apply locks, sits, exclusions, or replacements. Replacement
first tries the edited set and then keeps only the new machine required.
Candidate keys and
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

Before changing defaults: verify the opt-in flow on the deployment.
Keep experimental automatic singles opt-in until separately validated.
