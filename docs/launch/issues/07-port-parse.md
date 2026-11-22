---
title: "Validate PORT in the engine and runner configs instead of passing NaN through"
labels: good first issue, engine, cleanup
---

**What.** `app/src/config.ts` reads numbers through a small `int()` helper that falls back to the default for an empty or non-numeric value. The engine and the runner do not: `Number(env.PORT ?? 4200)` in `engine/src/config.ts` and `Number(env.PORT ?? 4100)` in `runner/src/config.ts` give `NaN` for `PORT=abc` and `0` for an empty `PORT=`, and the server then fails with a confusing listen error.

**Where to look.**
- `app/src/config.ts`: the `int(v, dflt, min, max)` helper and its use for `PORT`.
- `engine/src/config.ts`, `runner/src/config.ts`: `loadConfig`.
- Neither `loadConfig` has a test today (`grep -rn loadConfig engine/test runner/test` finds none); a small `config.test.ts` next to the other tests in each package is the place.

**Done when** both configs fall back to their default (4200 and 4100) for an empty, non-numeric or out-of-range `PORT`, with a test for each. Prefer a small helper in each package over a new shared dependency; the workspace rules say no new dependencies.
