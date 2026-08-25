FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV CI=true

FROM base AS dependencies
COPY package*.json ./
RUN npm ci

FROM dependencies AS build
COPY . ./
RUN npx prisma generate && npm run build

FROM dependencies AS development
COPY prisma ./prisma
RUN npx prisma generate

FROM node:22-bookworm-slim AS production
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV TESSDATA_PREFIX=/app/traineddata

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/public ./public
COPY --from=build /app/traineddata ./traineddata
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma

RUN mkdir -p logs uploads

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:3000/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

EXPOSE 3000

CMD ["node", "dist/server.js"]
