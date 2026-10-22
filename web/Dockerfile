# Build context: repo root (see docker-compose.yml); sync-mocks reads ../docs/mocks.
FROM node:22-alpine AS build
WORKDIR /repo/web
ARG NEXT_PUBLIC_API_MODE=mock
ARG NEXT_PUBLIC_TIDE_MODE=mock
ARG NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
ARG NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws
ENV NEXT_PUBLIC_API_MODE=$NEXT_PUBLIC_API_MODE NEXT_PUBLIC_TIDE_MODE=$NEXT_PUBLIC_TIDE_MODE \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL \
    NEXT_TELEMETRY_DISABLED=1
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY docs/mocks /repo/docs/mocks
COPY web/ ./
RUN npm run build

FROM node:22-alpine
WORKDIR /repo/web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /repo/web ./
EXPOSE 3000
CMD ["npm", "start"]
