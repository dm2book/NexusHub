# ForgeMarket Discord bot — always-on worker. Discord uses a long-lived gateway
# connection, so this is a background process; the only port it opens is the
# small /health endpoint (PORT), which says whether the gateway is connected.
FROM node:20-alpine

WORKDIR /app

# Install only production deps first for better layer caching.
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev

# App source, owned by the non-root user: the bot writes its fallback state
# files (xp.json, giveaways.json, bot-meta.json) next to src/, and a root-owned
# /app made every one of those writes fail silently.
COPY --chown=node:node . .

# Run as the built-in non-root user.
USER node

# Docker's own check, for hosts that use it (Railway uses healthcheckPath in
# railway.json at deploy time). Skipped quietly when no PORT is set.
HEALTHCHECK --interval=60s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "const p=process.env.PORT;if(!p)process.exit(0);fetch('http://127.0.0.1:'+p+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# The bot reads its secrets from environment variables (DISCORD_TOKEN, etc.).
# Do NOT bake secrets into the image — set them in your host's dashboard.
# node directly, not `npm start`: npm does not forward SIGTERM reliably, and
# the bot needs it to flush state before the container is replaced.
CMD ["node", "src/bot.js"]
