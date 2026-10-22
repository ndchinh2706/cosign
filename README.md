# Cosign

Production access for AI agents, without god keys: low-risk actions run instantly, high-risk ones need a human quorum that TideCloak enforces cryptographically.

## Project overview

<!-- TODO #27: fill in each section for judging. -->

### Vision & originality

### Trust constraint insight

### Value & impact

### Why TideCloak matters

### Prototype & storytelling

## Run locally

### Mock mode (no TideCloak)

Backend (FastAPI on :8000, `AUTH_MODE=dev` so requests use the `X-Demo-User` header):

```bash
cd api
python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
make -C .. dev-api            # or: AUTH_MODE=dev .venv/bin/uvicorn app.main:app --reload
.venv/bin/python -m pytest -q
curl -H 'X-Demo-User: linh.tran' localhost:8000/api/v1/requests
```

Frontend (Next.js on :3000):

```bash
cd web
npm install
npm run dev                   # NEXT_PUBLIC_API_MODE=mock by default: reads public/mocks (synced from docs/mocks)
NEXT_PUBLIC_API_MODE=live npm run dev   # call the local api instead
```

Every endpoint in `docs/API.md` already exists on the api and returns the matching file from `docs/mocks/`, so `mock` and `live` modes render the same data. Copy `.env.example` to `.env` to change modes.

### Full mode (TideCloak + api + web)

```bash
cp .env.example .env          # set AUTH_MODE=tide, NEXT_PUBLIC_*_MODE=live
docker compose up -d tidecloak
cd web && SUBSCRIPTION_EMAIL=you@example.com npm run init   # provisions realm "cosign", client "cosign-web", writes web/tidecloak.json
docker compose up --build
```

`npm run init` prints an "ACTION REQUIRED" link for Tide enrollment; keep it running until it finishes (TideCloak Quickstart).

## Repo layout

```
api/             FastAPI: REST /api/v1, WS /ws, SQLite, TideGovernance adapter
  app/routers/   one module per endpoint group; mocks mounted via app/mocks.py
web/             Next.js (App Router) from npm init @tidecloak/nextjs
  src/app/       route per screen in docs/SCREENS.md (placeholders)
  src/lib/       api.ts (mock|live), ws.ts (useCosignSocket), tide.ts (doEncrypt/doDecrypt)
docs/            API contract, OpenAPI, mocks, screens, board
design/          Claude Design prototype to port from
docker-compose.yml  tidecloak :8080, api :8000, web :3000
```
