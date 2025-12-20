# DM Vault - local-first vault with updatable core + persistent user data

FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json ./
COPY package-lock.json ./
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/* \
  && npm ci
COPY public ./public
COPY src ./src
COPY scripts ./scripts
RUN npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_DIR=/data

COPY package.json ./
COPY package-lock.json ./
COPY server ./server
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules

EXPOSE 8080
CMD ["node", "server/index.js"]
