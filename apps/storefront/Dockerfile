FROM node:24-alpine AS dependencies
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/admin/package.json apps/admin/package.json
COPY apps/storefront/package.json apps/storefront/package.json
COPY services/api/package.json services/api/package.json
RUN npm install --package-lock=false --workspace @shop-platform/storefront --include-workspace-root=false --include=optional

FROM node:24-alpine AS build
WORKDIR /repo
COPY --from=dependencies /repo/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY apps/storefront ./apps/storefront
ARG NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build --workspace @shop-platform/storefront

FROM node:24-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app/apps/storefront
COPY --from=dependencies /repo/node_modules ./node_modules
COPY --from=build /repo/apps/storefront/package.json ./package.json
COPY --from=build /repo/apps/storefront/.next ./.next
COPY --from=build /repo/apps/storefront/public ./public
ENV PORT=3000
EXPOSE 3000
CMD ["npm", "run", "start"]
