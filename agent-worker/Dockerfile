# LiveKit Cloud Agents / any container host
# Long-lived Node worker — do NOT deploy to Cloudflare/Vercel/Lambda.
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json worker.ts ./
RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# LiveKit Cloud Agents injects env vars at runtime:
#   LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, OPENAI_REALTIME_API_KEY
CMD ["node", "dist/worker.js", "start"]
