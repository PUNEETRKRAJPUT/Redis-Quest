# One image for engine, app, runner and the Next.js UI; compose services differ only by `command`.
# Build context is the repo root. Anything not wanted in the context is listed in
# docker/node.Dockerfile.dockerignore (BuildKit reads it next to this file).

# ---- build: full install, compile every package ----------------------------
FROM node:22-bookworm-slim AS build
ENV CI=true NEXT_TELEMETRY_DISABLED=1
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
# Assemble the standalone UI server. `next build` leaves static files and public/ outside the standalone folder
# (the self-hosting guide: they are copied in by hand). cp -a keeps the pnpm symlinks inside it intact, and
# ui/public may not exist yet, so it is created empty first.
RUN mkdir -p ui/public \
    && cp -a ui/.next/standalone /ui-standalone \
    && cp -a ui/.next/static /ui-standalone/ui/.next/static \
    && cp -a ui/public /ui-standalone/ui/public
# Next traces `sharp` (image optimisation) with its 36 MB of libvips builds. The UI never uses next/image, so drop
# them and the symlinks left dangling; Next only loads sharp lazily, when an image is optimised.
RUN rm -rf /ui-standalone/node_modules/.pnpm/@img+* /ui-standalone/node_modules/.pnpm/sharp@* \
    && find /ui-standalone -xtype l -delete

# ---- runtime: production deps + dist/ + the standalone UI server -----------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production CI=true NEXT_TELEMETRY_DISABLED=1
WORKDIR /srv
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY engine/package.json engine/
COPY app/package.json app/
COPY runner/package.json runner/
COPY ui/package.json ui/
# The UI ships as a self-contained standalone server (traced node_modules included), so its own dependencies
# stay out of this install.
RUN pnpm install --frozen-lockfile --prod --filter '!@quest/ui' \
    && pnpm store prune

COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/engine/dist engine/dist
COPY --from=build /repo/app/dist app/dist
COPY --from=build /repo/runner/dist runner/dist
# Own folder: the standalone output carries its own node_modules and must not mix with the install above.
COPY --from=build /ui-standalone ui-standalone
# Level and scenario data are read by the engine at run time.
COPY levels levels
# The Economy League reads its holes and entries from here (D-07).
COPY golf golf
COPY scenarios scenarios

USER node
CMD ["node", "engine/dist/main.js"]
