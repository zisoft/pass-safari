.PHONY: build run all

PROJECT_NAME=pass-safari
EXTENSION_TARGET=pass-safari

all: build run
# all: build

build:
	xcodebuild -project "$(PROJECT_NAME).xcodeproj" \
		-scheme "$(PROJECT_NAME)" \
		-configuration Debug \
		CONFIGURATION_BUILD_DIR="$(PWD)/build" build

run:
	open build/$(PROJECT_NAME).app

clean:
	@xcodebuild -project "$(PROJECT_NAME).xcodeproj" \
		-scheme "$(PROJECT_NAME)" \
		-configuration Debug \
		clean
	@rm -rf build

