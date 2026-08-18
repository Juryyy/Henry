# Jeden obraz: appka i server. Appku servíruje ten samý proces, který má API,
# takže všechno běží z jedné adresy – žádný CORS a přihlašovací cookie funguje.

# 1. Sestavení appky.
FROM node:22-alpine AS app
WORKDIR /build
COPY app/package*.json ./
RUN npm ci
COPY app/ ./
# Appka běží v kořeni domény, ne v podadresáři.
RUN BASE_PATH=/ npm run build:only

# 2. Překlad serveru.
FROM node:22-alpine AS server
WORKDIR /build
COPY server/package*.json ./
RUN npm ci
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build

# 3. Výsledný obraz – jen to, co je potřeba k běhu.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# `node:sqlite` je v Node 22 ještě za přepínačem. Od Node 24 je zabudované
# napevno a tenhle řádek jde vyhodit.
ENV NODE_OPTIONS=--experimental-sqlite

COPY server/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=server /build/dist ./dist
COPY --from=app /build/dist ./public

ENV APP_DIR=/app/public
ENV DB_FILE=/app/data/henry.sqlite

# Databáze žije ve svazku, ať přežije přebuildování obrazu.
VOLUME ["/app/data"]

# Neběžet pod rootem.
USER node

EXPOSE 8080
CMD ["node", "dist/index.js"]
