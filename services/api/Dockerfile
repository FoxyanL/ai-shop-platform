FROM node:24-alpine AS dependencies
WORKDIR /repo
COPY package.json package-lock.json ./
COPY services/api/package.json services/api/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY apps/storefront/package.json apps/storefront/package.json
RUN npm install --package-lock=false --workspace @shop-platform/api --include-workspace-root=false --include=optional

FROM node:24-alpine AS build
WORKDIR /repo
COPY --from=dependencies /repo/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY services/api ./services/api
RUN npm run build --workspace @shop-platform/api

FROM node:24-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app/services/api
COPY --from=dependencies /repo/node_modules /app/node_modules
COPY --from=build /repo/services/api/dist ./dist
COPY services/api/migrations ./migrations
COPY services/api/openapi.json ./openapi.json
COPY services/api/package.json ./package.json
EXPOSE 4000
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/server.js"]
