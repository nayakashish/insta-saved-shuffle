# Saved Shuffle: static site plus a zero-dependency Node server.
FROM node:22-alpine

ENV NODE_ENV=production \
    DOCKER=1 \
    HOST=0.0.0.0 \
    PORT=3005 \
    DEFAULT_LIST=/app/saved/saved_posts.html

WORKDIR /app
COPY --chown=root:root package.json server.mjs ./
COPY --chown=root:root public ./public

# Files are owned by root and read-only to the app user.
USER node
EXPOSE 3005

CMD ["node", "server.mjs"]
