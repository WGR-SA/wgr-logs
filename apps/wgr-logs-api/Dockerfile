# Build from monorepo root:
#   docker build -t wgr-logs-api -f apps/wgr-logs-api/Dockerfile .

# ---- Build stage ----
FROM node:20-alpine AS builder
WORKDIR /app

# Copy root manifests + workspace manifests for an efficient install layer
COPY package.json package-lock.json* tsconfig.base.json ./
COPY apps/wgr-logs-api/package.json apps/wgr-logs-api/
COPY packages/alloy-modules/package.json packages/alloy-modules/

RUN npm install --workspaces --include-workspace-root --no-audit --no-fund \
    --workspace=@wgr/wgr-logs-api --workspace=@wgr/alloy-modules

# Copy sources
COPY apps/wgr-logs-api/ apps/wgr-logs-api/
COPY packages/alloy-modules/ packages/alloy-modules/

WORKDIR /app/apps/wgr-logs-api
RUN npm run build

# ---- Runtime stage ----
FROM node:20-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache wget

# Production deps only
COPY --from=builder /app/package.json /app/package-lock.json* /app/tsconfig.base.json ./
COPY --from=builder /app/apps/wgr-logs-api/package.json ./apps/wgr-logs-api/
COPY --from=builder /app/packages/alloy-modules ./packages/alloy-modules

RUN npm install --workspaces --include-workspace-root --omit=dev --no-audit --no-fund \
    --workspace=@wgr/wgr-logs-api --workspace=@wgr/alloy-modules

# Compiled output
COPY --from=builder /app/apps/wgr-logs-api/dist ./apps/wgr-logs-api/dist

# Source-types schema served by /source-types endpoint
# (path expected by src/source-types/source-types.controller.ts:
#  join(__dirname, '..', '..', 'schemas', 'source-types.json'))
RUN mkdir -p apps/wgr-logs-api/schemas \
    && cp packages/alloy-modules/schemas/source-types.json apps/wgr-logs-api/schemas/

ENV NODE_ENV=production \
    API_PORT=3000

WORKDIR /app/apps/wgr-logs-api
EXPOSE 3000

CMD ["node", "dist/main.js"]
