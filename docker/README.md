# docker/

- `node.Dockerfile`: one multi-stage image (`redis-quest-node`) for engine, app and runner. Services differ by `command`.
- `node.Dockerfile.dockerignore`: keeps host `node_modules`, `dist`, `docs`, `.env` out of the build context.
- `Caddyfile`: proxy on :3000. `/app/*` goes to the `app` service (prefix kept) through a `dynamic a` upstream re-resolved every second with `lb_policy round_robin`, so `--scale app=N` balances per request even over keep-alive connections, everything else to `engine:4200`. JSON access log at `logs/proxy/access.log`.
- `sentinel/sentinel.conf`: shared Sentinel config; each container copies it to a writable path at start.

Run everything with `scripts/start`, stop with `scripts/stop`, wipe data with `scripts/reset`. Host ports live in `.env` (see `.env.example`).
