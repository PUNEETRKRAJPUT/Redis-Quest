# P0-11: Redis Insight auto-provisioning

**Goal.** When the stack starts, Redis Insight already knows the `redis` database, so a beginner opens
http://localhost:5540 and sees keys, never an "add database" form or a blocking first-run dialog.

**Depends on.** P0-02

**Files owned.**
- `docker/insight/` (provisioning script and any config)
- `docker-compose.yml`: only a new one-shot service `insight-init` placed between the markers
  `# --- P0-11 insight-init start` and `# --- P0-11 insight-init end` (add the markers), plus any env
  on the `insight` service needed to skip first-run prompts (keep it to a clearly commented block)
- `scripts/check/P0-11.sh`

**Must not touch.** anything else.

**Interfaces to honour.**
- The database appears in Insight named `Redis Quest`, host `redis`, port `6379`, no password.
- Idempotent: running `insight-init` again never creates a duplicate.
- Insight's REST API is documented by the running container at `http://localhost:5540/api/docs`
  (Swagger); discover the exact endpoints there rather than guessing (expected: `GET/POST /api/databases`
  and a settings or agreements endpoint). `docs/redis-docs-digest.md`, "Docker and packaging facts",
  item 4, has what the official docs say about the image.
- `insight-init` uses a tiny arm64 image with `curl` (for example `curlimages/curl`), waits for
  `http://insight:5540/api/health/`, then provisions. It must not need Node.

**Work.**
1. Investigate the API with the stack up (`docker compose up -d redis insight`), find how to accept
   the first-run agreements and how to add a database, and write it down in `docker/insight/README.md`
   with the exact requests.
2. `docker/insight/provision.sh` (POSIX sh, runs inside the curl image) and the compose service.
3. `scripts/check/P0-11.sh`: `docker compose up -d redis insight insight-init`; wait; `GET /api/databases`
   lists exactly one database named `Redis Quest` with host `redis`; run `insight-init` again, still
   exactly one; if an agreements endpoint exists, assert it reports accepted; `docker compose down`.

**Acceptance check.** `scripts/check/P0-11.sh` exits 0.

**Handoff complete when.** check passes; `docs/handoffs/P0-11.md` written with the API requests used
and the check output; no files outside "Files owned" changed.

**Model.** sonnet
