FROM node:24-alpine AS dependencies
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/admin/package.json apps/admin/package.json
COPY apps/storefront/package.json apps/storefront/package.json
COPY services/api/package.json services/api/package.json
RUN npm ci --workspace @shop-platform/admin --include-workspace-root=false

FROM node:24-alpine AS build
WORKDIR /repo
COPY --from=dependencies /repo/node_modules ./node_modules
COPY --from=dependencies /repo/apps/admin/node_modules ./apps/admin/node_modules
COPY package.json package-lock.json ./
COPY apps/admin ./apps/admin
ARG VITE_API_URL=/api/v1
ARG VITE_STOREFRONT_URL=http://localhost:3000
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_STOREFRONT_URL=$VITE_STOREFRONT_URL
RUN npm run build --workspace @shop-platform/admin

FROM nginx:1.27-alpine AS runner
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/admin/dist /usr/share/nginx/html
EXPOSE 80
