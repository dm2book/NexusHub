# ForgeMarket Discord bot — always-on worker (no web port; Discord uses a
# long-lived gateway connection, so this is a background process, not a server).
FROM node:20-alpine

WORKDIR /app

# Install only production deps first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# App source.
COPY . .

# Run as the built-in non-root user.
USER node

# The bot reads its secrets from environment variables (DISCORD_TOKEN, etc.).
# Do NOT bake secrets into the image — set them in your host's dashboard.
CMD ["npm", "start"]
