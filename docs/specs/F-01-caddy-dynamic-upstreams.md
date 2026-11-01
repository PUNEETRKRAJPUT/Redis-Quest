# F-01: Caddy dynamic upstreams for the scaled app

**Goal.** With `docker compose up -d --scale app=2`, consecutive browser requests should reach both
app instances without the app closing every connection (`APP_MAX_REQUESTS_PER_SOCKET=1`, the current
workaround in `app/src`, see `docs/handoffs/P0-07.md` decision 2).

**Files owned.** `docker/Caddyfile`, `docker/README.md`, the `app` service `environment` in
`docker-compose.yml` only to change the default of `APP_MAX_REQUESTS_PER_SOCKET` (do not touch other
services), `scripts/check/F-01.sh`.

**Must not touch.** `app/` source (if the env default lives in code, set it via compose env instead).

**Work.** In the Caddyfile, route `/app/*` to `reverse_proxy` with a dynamic upstream source that
re-resolves the compose service name each request or every second (Caddy's `dynamic a` upstreams on
`app:4000` with a short `refresh`), `lb_policy round_robin`, and `lb_try_duration` small; keep WebSocket
and everything else going to `engine:4200`. Then set `APP_MAX_REQUESTS_PER_SOCKET` so keep-alive is back
on (whatever value the app treats as unlimited; read `app/src` to find it) and prove distribution still
holds.

**Isolation.** Use compose project `quest-f01` with `.env.f01` (ports 3400/6394/5436/5544), services
`redis postgres engine app proxy`; finish with `docker compose -p quest-f01 down -v`. Never touch other
projects.

**Check.** `scripts/check/F-01.sh`: start the project, scale app to 2, make 40 sequential keep-alive
requests from ONE curl process (`curl` with multiple URLs in one invocation reuses the connection) to
`/app/health` and assert both `instance` values appear; also 40 separate curls; print the split; assert
`APP_MAX_REQUESTS_PER_SOCKET` is no longer 1 in the running app's env; tear down.

**Handoff.** `docs/handoffs/F-01.md` with the Caddyfile diff explained and the measured splits.

**Model.** sonnet
