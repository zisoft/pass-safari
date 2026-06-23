.PHONY: build run all

PROJECT_NAME=pass-safari
EXTENSION_TARGET=pass-safari

all: build run

build:
	xcodebuild -project "$(PROJECT_NAME).xcodeproj" \
		-scheme "$(PROJECT_NAME)" \
		-configuration Debug \
		CONFIGURATION_BUILD_DIR="$(PWD)/build" build

run:
	open build/$(PROJECT_NAME).app
