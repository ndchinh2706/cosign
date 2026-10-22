.PHONY: setup dev-api dev-web test up

setup:
	cd api && python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
	cd web && npm install

dev-api:
	cd api && AUTH_MODE=$${AUTH_MODE:-dev} .venv/bin/uvicorn app.main:app --reload --port 8000

dev-web:
	cd web && npm run dev

test:
	cd api && .venv/bin/python -m pytest -q
	cd web && npm run lint && npm run build

up:
	docker compose up --build
