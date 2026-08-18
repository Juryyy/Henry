# Dvoufázový build: v prvním se přeloží TypeScript, do druhého se kopíruje
# jen to, co je potřeba k běhu.
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# `node:sqlite` je v Node 22 ještě za přepínačem. Od Node 24 je zabudované
# napevno a tenhle řádek jde vyhodit.
ENV NODE_OPTIONS=--experimental-sqlite
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

# Data žijí ve svazku, ať přežijí přebuildování obrazu: provozní stav serveru
# v JSONu, synchronizovaná data uživatele v SQLite.
VOLUME ["/app/data"]
ENV DATA_FILE=/app/data/db.json
ENV SYNC_FILE=/app/data/henry.sqlite

# Neběžet pod rootem.
USER node

EXPOSE 8080
CMD ["node", "dist/index.js"]
