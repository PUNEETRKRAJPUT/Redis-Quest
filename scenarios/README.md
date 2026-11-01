# scenarios/

Load scenarios for `traffic` verifiers (and, later, chaos spikes and the live pain panel). The engine
runs them with autocannon from inside the `engine` container against the app through the proxy
(`APP_URL`, default `http://proxy:3000/app`). Architecture: `docs/PLAN.md` section 2. The parser is
`engine/src/load/scenario.ts`; unknown keys are errors.

## Format (`scenarios/<id>.yaml`, the file name is the id)

```yaml
id: toss-time-100             # kebab-case, equal to the file name
description: "..."            # optional
durationSec: 10               # measured run length (1-600, then capped)
connections: 50               # concurrent connections (1-10000, then capped)
pipelining: 1                 # optional, default 1
seed: 20260101                # optional, default 1: same seed, same request sequence
warmup:                       # optional: runs first, results discarded, then 3.2 s of quiet
  durationSec: 2
  connections: 5
users:                        # who sends the requests
  count: 100                  # user ids 1..count
  distribution: uniform       # uniform | zipf (rank 1 is the hottest)
  zipfSkew: 1.1               # required with zipf, not allowed with uniform
  idPattern: "u-{n}"          # optional, default "u-{n}"
  pad: 6                      # optional, default 6 (u-000042)
params:                       # optional named value pools, sampled per request
  player:
    values: [p-028, p-101, p-151]
    distribution: uniform     # uniform | zipf (+ zipfSkew), first value is rank 1
requests:                     # the mix; one is picked per request by weight
  - method: GET               # GET POST PUT PATCH DELETE HEAD
    path: /app/players/{player}/stats   # must start with /app/; {user} and {<param>} are filled in
    weight: 1                 # optional, default 1
    userIdHeader: x-user-id   # optional: header carrying the sampled user id
    body: { userId: "{user}" }          # optional JSON body, strings templated like the path
```

## Caps

`LOAD_MAX_CONNECTIONS` (default 200) and `LOAD_MAX_DURATION_SEC` (default 30) clamp every run,
including the warmup; `LOW_POWER=1` halves both. The verifier reports when a cap applied
(`details.capped`).

## What a run measures

From autocannon: p50, p99, requests per second (responses / duration), status codes, and the error
rate = (5xx + requests without any response) / all attempts. A 404 or 429 is an answer, not an error.
From the app's metric pushes for exactly the run's window: requests, Postgres queries, Redis commands
and `noDbCount` (requests that made no Postgres query), hence Postgres calls per request and the cache
hit ratio. Baselines are stored at `${PROGRESS_DIR}/baselines/<id>.json`; see docs/handoffs/P0-09.md.
