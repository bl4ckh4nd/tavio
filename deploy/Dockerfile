FROM node:24-alpine AS build
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN corepack enable \
  && corepack prepare pnpm@11.25.0 --activate \
  && pnpm install --frozen-lockfile --ignore-scripts

COPY . .
ARG VITE_CONVEX_URL
ARG VITE_CONVEX_SITE_URL
ARG DEPLOYMENT_SHA
ENV VITE_CONVEX_URL=$VITE_CONVEX_URL
ENV VITE_CONVEX_SITE_URL=$VITE_CONVEX_SITE_URL
RUN npm run build
RUN test -n "$DEPLOYMENT_SHA" && printf '%s\n' "$DEPLOYMENT_SHA" > /app/dist/deployment.txt

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
