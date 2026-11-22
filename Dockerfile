FROM node:26-bookworm-slim AS build
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
# Corepack only ships with Node < 25, so pnpm comes from npm, at the version
# in package.json's packageManager field.
RUN npm install -g "$(node -p 'require("./package.json").packageManager')" \
 && pnpm install --frozen-lockfile \
 && pnpm build \
 && pnpm --filter sundhedmcp deploy --prod --legacy /out

# The runtime image holds what npm would install: bin, dist/lib (bundled with
# the workspace packages) and the npm dependencies.
FROM node:26-bookworm-slim
LABEL org.opencontainers.image.title="SundhedMCP" \
      org.opencontainers.image.description="SundhedMCP runs locally only; this image serves a page that says so." \
      org.opencontainers.image.source="https://github.com/manas-katyal/sundhedmcp" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=8080 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright SUNDHEDMCP_BROWSER=chromium
COPY --from=build /out ./
RUN node node_modules/playwright-core/cli.js install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/*
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/lib/server.js"]
