.DEFAULT_GOAL := install

HOST_UID ?= $(shell id -u)
HOST_GID ?= $(shell id -g)
export HOST_UID HOST_GID

.PHONY: install
install:
	docker compose run --rm --no-deps -T node npm ci
