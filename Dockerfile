# Saved Shuffle: static site plus a zero-dependency Node server.
FROM node:22-alpine

ENV NODE_ENV=production \
    DOCKER=1 \
    HOST=0.0.0.0 \
    PORT=4321 \
    DEFAULT_LIST=/app/saved/saved_posts.html

WORKDIR /app
COPY --chown=root:root package.json server.mjs ./
COPY --chown=root:root public ./public

# Files are owned by root and read-only to the app user.
USER node
EXPOSE 4321

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:4321/healthz || exit 1

CMD ["node", "server.mjs"]
