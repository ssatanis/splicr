.PHONY: help build push test clean

help:
	@echo "SplicR Analysis Engine - Available Commands:"
	@echo "  make build     - Build all Docker containers"
	@echo "  make push      - Push containers to ECR"
	@echo "  make test      - Run local tests"
	@echo "  make clean     - Clean up containers and images"
	@echo "  make run-local - Run analysis locally"

build:
	@echo "Building all containers..."
	./scripts/build_containers.sh

push:
	@echo "Pushing containers to ECR..."
	./scripts/push_to_ecr.sh

test:
	@echo "Running local tests..."
	./scripts/test_local.sh

clean:
	@echo "Cleaning up..."
	docker-compose -f docker-compose.analysis.yml down
	docker system prune -f

run-local:
	docker-compose -f docker-compose.analysis.yml up

build-mageck:
	docker build -t splicr/mageck:latest docker/mageck/

build-bagel2:
	docker build -t splicr/bagel2:latest docker/bagel2/

build-drugz:
	docker build -t splicr/drugz:latest docker/drugz/

build-viz:
	docker build -t splicr/visualization:latest docker/visualization/
