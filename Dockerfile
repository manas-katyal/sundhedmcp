FROM node:24-bookworm-slim
LABEL org.opencontainers.image.title="SundhedMCP" \
      org.opencontainers.image.description="Read-only MCP server for your own sundhed.dk record. Self-hosted, one user." \
      org.opencontainers.image.source="https://github.com/manas-katyal/sundhedmcp" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=8080 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright SUNDHEDMCP_BROWSER=chromium
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force \
 && npx playwright-core install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/*
COPY src ./src
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "src/server.ts"]
