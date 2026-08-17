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
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

# Data (jeden JSON soubor) žijí ve svazku, ať přežijí přebuildování obrazu.
VOLUME ["/app/data"]
ENV DATA_FILE=/app/data/db.json

# Neběžet pod rootem.
USER node

EXPOSE 8080
CMD ["node", "dist/index.js"]
