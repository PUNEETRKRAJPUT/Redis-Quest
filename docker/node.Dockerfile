# One image for engine, app and runner; compose services differ only by `command`.
# Build context is the repo root. Anything not wanted in the context is listed in
# docker/node.Dockerfile.dockerignore (BuildKit reads it next to this file).

# ---- build: full install, compile every package ----------------------------
FROM node:22-bookworm-slim AS build
ENV CI=true
WORKDIR /repo
# pnpm version is pinned by "packageManager" in package.json; corepack fetches exactly that.
RUN corepack enable

# Manifests first so the dependency layer is cached until a package.json or the lockfile changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY engine/package.json engine/
COPY app/package.json app/
COPY runner/package.json runner/
COPY ui/package.json ui/
RUN pnpm install --frozen-lockfile

COPY packages packages
COPY engine engine
COPY app app
COPY runner runner
COPY ui ui
RUN pnpm -r build

# ---- runtime: production deps + dist/ only ---------------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production CI=true
WORKDIR /srv
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY engine/package.json engine/
COPY app/package.json app/
COPY runner/package.json runner/
COPY ui/package.json ui/
# ui is a browser bundle (served as static files), so its dependencies stay out of the runtime image.
RUN pnpm install --frozen-lockfile --prod --filter '!@quest/ui' \
    && pnpm store prune

COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/engine/dist engine/dist
COPY --from=build /repo/app/dist app/dist
COPY --from=build /repo/runner/dist runner/dist
COPY --from=build /repo/ui/dist ui/dist
# Level and scenario data are read by the engine at run time.
COPY levels levels
COPY scenarios scenarios

USER node
CMD ["node", "engine/dist/main.js"]
