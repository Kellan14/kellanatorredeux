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

League history is paginated once per preview request; the computed
player-machine evidence is reused throughout the search and its explanations.
No cross-request cache is added yet. The selected season range and model
version accompany the response. Model score differences are not projected
match points or statistical confidence intervals.

## Verification and remaining rollout gates

- `npx tsc --noEmit`
- `node --import ./scripts/strategy/lib/register-alias.mjs scripts/test-assignment-estimator.mjs`
- `node --import ./scripts/strategy/lib/register-alias.mjs scripts/test-normalization-api.mjs`
- `node --experimental-strip-types scripts/test-ranked-doubles.mjs`
- The archived TWC snapshot reproduced both prior Hungarian results (zero
  and three minimum games) across 14,950 machine sets. A separate local
  invocation against current league history returned five valid lineups in
  about 5.3 seconds, including database reads and search. This is one
  measurement, not a production performance guarantee.

Before changing defaults: check the preview in a mobile viewport, measure
cold/warm production-equivalent requests, design cache invalidation for score
and canon changes, rerun chronological evaluation against the shared model,
and decide how to migrate the main Strategy controls and reports. Do not
automatically apply this doubles model to singles or custom scoring.
