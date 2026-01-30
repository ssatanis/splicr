.PHONY: help build up down restart logs test clean migrate shell

help:
	@echo "SplicR Backend - Available Commands:"
	@echo "  make build      - Build Docker images"
	@echo "  make up         - Start all services"
	@echo "  make down       - Stop all services"
	@echo "  make restart    - Restart all services"
	@echo "  make logs       - View logs"
	@echo "  make test       - Run tests"
	@echo "  make migrate    - Run database migrations"
	@echo "  make shell      - Open API container shell"
	@echo "  make clean      - Clean up containers and volumes"
	@echo "  make format     - Format code with black"
	@echo "  make lint       - Lint code"

build:
	docker-compose build

up:
	docker-compose up -d
	@echo "Services started!"
	@echo "API: http://localhost:8000"
	@echo "Docs: http://localhost:8000/api/docs"
	@echo "Flower: http://localhost:5555"

down:
	docker-compose down

restart:
	docker-compose restart

logs:
	docker-compose logs -f

logs-api:
	docker-compose logs -f api

logs-worker:
	docker-compose logs -f worker

test:
	docker-compose exec api pytest -v

test-cov:
	docker-compose exec api pytest --cov=app --cov-report=html

migrate:
	docker-compose exec api alembic upgrade head

migrate-create:
	@read -p "Enter migration message: " msg; \
	docker-compose exec api alembic revision --autogenerate -m "$$msg"

shell:
	docker-compose exec api /bin/bash

shell-db:
	docker-compose exec db psql -U splicr -d splicr

shell-redis:
	docker-compose exec redis redis-cli

clean:
	docker-compose down -v
	find . -type d -name __pycache__ -exec rm -rf {} +
	find . -type f -name "*.pyc" -delete
	find . -type f -name "*.pyo" -delete
	find . -type f -name "*.db" -delete

format:
	docker-compose exec api black app/

lint:
	docker-compose exec api flake8 app/

dev:
	uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

worker:
	celery -A app.tasks.celery_tasks:celery_app worker --loglevel=info

flower:
	celery -A app.tasks.celery_tasks:celery_app flower --port=5555

install:
	pip install -r requirements.txt

freeze:
	pip freeze > requirements.txt
