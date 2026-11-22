---
title: "Say which route was not found in the engine's 404 message"
labels: good first issue, engine
---

**What.** An unknown API route answers `{ "error": "not_found", "message": "route not found" }` (two places in `engine/src/server.ts`). The message does not say which method and path, so a mistyped URL in a script gives no clue.

**Where to look.**
- `engine/src/server.ts`: `api.setNotFoundHandler` (near the end of the `/api` plugin) and `app.setNotFoundHandler` just below it. A third `404 not_found` at `HttpError(404, 'not_found', 'route not found')` is the dev-only route guard; leave its wording unless you can improve it too.
- Nothing in `engine`, `ui` or `scripts` matches on the text `route not found` (`grep -rn "route not found"` shows only the three server lines), so the `error` code stays and only `message` changes.

**Done when** the message reads like `no route for GET /api/nope` (method and path without the query string, so a token in a query is never echoed), and there is a test in an engine test file that already builds the server (`engine/test/command-docs.test.ts` shows how) which asks for an unknown route and checks the new message.
