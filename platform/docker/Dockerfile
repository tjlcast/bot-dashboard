# Build with the platform directory as context:
# docker build -f docker/Dockerfile -t agent-control-plane .
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node server ./server
COPY --chown=node:node public ./public
RUN mkdir -p /app/data && chown node:node /app/data

USER node

EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/v1/traces').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server/index.js"]
