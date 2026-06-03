# MemeForge API image (monorepo-aware)
FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl

# Install workspace deps
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm install

# Copy sources
COPY packages/shared packages/shared
COPY apps/api apps/api

# Generate Prisma client + build
WORKDIR /app/apps/api
RUN npx prisma generate
WORKDIR /app
RUN npm run build -w @memeforge/shared && npm run build -w @memeforge/api

EXPOSE 4000
WORKDIR /app/apps/api
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
