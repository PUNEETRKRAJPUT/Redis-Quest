# P0-01: Repo skeleton

**Goal.** Create the pnpm workspace, TypeScript base and package layout every later task builds in, so
that `pnpm -r build`, `pnpm -r lint` and `pnpm -r test` pass on an empty project. Nothing functional yet.

**Depends on.** nothing

**Files owned.**
- `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.npmrc`, `.node-version`, `.editorconfig`
- `tsconfig.base.json`, `eslint.config.js`, `.prettierrc`, `vitest.workspace.ts` (if used)
- `packages/shared/` (package `@quest/shared`)
- `engine/`, `app/`, `runner/`, `ui/` (packages `@quest/engine`, `@quest/app`, `@quest/runner`, `@quest/ui`)
- `levels/README.md`, `scenarios/README.md`, `workspace/README.md`
- `scripts/check/P0-01.sh`, `scripts/check/all.sh`

**Must not touch.** `docs/`, `docker/`, `docker-compose.yml`, `scripts/start`, `scripts/preflight.sh`,
`postgres/`, `fiction/`, `CLAUDE.md`, `README.md`.

**Interfaces to honour.**
- Node 22 in containers; the host may run newer. `engines.node >= 22`, `.node-version` = `22`.
- pnpm 10 via corepack: `"packageManager": "pnpm@10.x.y"` (use the version installed on this Mac,
  `pnpm --version`).
- ESM everywhere (`"type": "module"`), TypeScript strict, `moduleResolution: bundler` for `ui`,
  `NodeNext` for the Node packages, `outDir: dist`.
- `engine`, `app`, `runner` each expose `src/main.ts` that, for now, prints its package name and
  exits 0. `ui` is a Vite + React + TypeScript app whose `pnpm build` produces `dist/index.html`.
- `packages/shared/src/index.ts` exports placeholder types that later tasks fill in:
  `export type LevelId = string; export type SlotName = string; export interface Progress { version: 1 }`.
- Each package has one trivial vitest test so `pnpm -r test` exercises the runner.
- ESLint flat config with `typescript-eslint` recommended; Prettier with single quotes, 2 spaces,
  100-column width, trailing commas `all`. Keep rules minimal; later tasks must not fight the linter.
- `levels/`, `scenarios/`, `workspace/` each get a README (3 to 6 lines) saying what will live there,
  pointing at `docs/PLAN.md` sections 4, 2 and 2 respectively.

**Work.**
1. Root `package.json` with scripts `build`, `lint`, `test`, `format` fanning out with `pnpm -r`.
2. Workspace globs: `packages/*`, `engine`, `app`, `runner`, `ui`.
3. Packages as above; `@quest/shared` consumed by `engine`, `app`, `runner` through
   `workspace:*` and TypeScript project references or path mapping, whichever is simpler and works
   with `tsc -b`.
4. `scripts/check/P0-01.sh`: `pnpm install --frozen-lockfile`, `pnpm -r build`, `pnpm -r lint`,
   `pnpm -r test`, then assert the five package dirs and three READMEs exist and that
   `ui/dist/index.html` was produced. Print each assertion.
5. `scripts/check/all.sh`: runs every `scripts/check/P*.sh` and `scripts/check/C*.sh` in sorted order,
   stops at the first failure, prints a summary table of pass/fail. bash 3.2 compatible.
6. Commit the lockfile (do not commit `node_modules`, `dist`).

**Acceptance check.** `scripts/check/P0-01.sh` exits 0 on this Mac and prints what it verified.

**Handoff complete when.** check passes; `docs/handoffs/P0-01.md` written with the check output; no
files outside "Files owned" changed (`git status` shows only owned paths).

**Model.** sonnet
