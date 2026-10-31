# Redis Insight provisioning (P0-11)

`insight-init` (compose one-shot, image `curlimages/curl`) runs `provision.sh` against `http://insight:5540`.
Endpoints were discovered from the running container's Swagger (`/api/docs`, JSON at `/api/docs-json`,
Insight 3.x, agreements spec version 1.0.6).

1. Wait: `GET /api/health/` until it answers `{"status":"up"}`.
2. Agreements. `GET /api/settings` returns `"agreements":null` on a fresh volume. Accept with
   `PATCH /api/settings`, header `Content-Type: application/json`, body
   `{"agreements":{"eula":true,"analytics":false,"notifications":false,"encryption":false}}`.
   All four keys are required on first setup (see `GET /api/settings/agreements/spec`). Only `eula` is
   required; analytics and notifications are left off. Done when `GET /api/settings` shows `"eula":true`.
3. Database. `GET /api/databases` returns `[]` on a fresh volume. Add with `POST /api/databases`, body
   `{"name":"Redis Quest","host":"redis","port":6379}` (no password, answers 201). The script skips the POST if the
   list already contains `"name":"Redis Quest"`, so re-runs never duplicate.

No env is needed on the `insight` service. The `insight-data` volume keeps the result across restarts;
`scripts/reset` style wipes of that volume re-provision on the next `up`.
