BINARY_NAME := nfs-proxy
BUILD_DIR := bin
CMD_DIR := ./cmd/nfs-proxy

.PHONY: all build clean test run help

all: build

build:
	@echo "Building $(BINARY_NAME)..."
	@mkdir -p $(BUILD_DIR)
	@go build -o $(BUILD_DIR)/$(BINARY_NAME) $(CMD_DIR)
	@echo "Build complete! Binary: $(BUILD_DIR)/$(BINARY_NAME)"

build-linux:
	@echo "Building Linux binary..."
	@mkdir -p $(BUILD_DIR)
	@GOOS=linux GOARCH=amd64 go build -o $(BUILD_DIR)/$(BINARY_NAME)-linux-amd64 $(CMD_DIR)
	@echo "Linux build complete!"

build-windows:
	@echo "Building Windows binary..."
	@mkdir -p $(BUILD_DIR)
	@GOOS=windows GOARCH=amd64 go build -o $(BUILD_DIR)/$(BINARY_NAME)-windows-amd64.exe $(CMD_DIR)
	@echo "Windows build complete!"

build-mac:
	@echo "Building macOS binary..."
	@mkdir -p $(BUILD_DIR)
	@GOOS=darwin GOARCH=amd64 go build -o $(BUILD_DIR)/$(BINARY_NAME)-darwin-amd64 $(CMD_DIR)
	@echo "macOS build complete!"

clean:
	@echo "Cleaning..."
	@rm -rf $(BUILD_DIR)
	@rm -rf logs/
	@echo "Clean complete!"

test:
	@echo "Running tests..."
	@go test -v ./...

run-proxy:
	@go run $(CMD_DIR) proxy --listen :2049 --backend localhost:2049

run-mock:
	@go run $(CMD_DIR) mock --listen :2049

help:
	@echo "Available targets:"
	@echo "  build          - Build the binary"
	@echo "  build-linux    - Build Linux binary"
	@echo "  build-windows  - Build Windows binary"
	@echo "  build-mac      - Build macOS binary"
	@echo "  clean          - Clean build artifacts"
	@echo "  test           - Run tests"
	@echo "  run-proxy      - Run proxy server"
	@echo "  run-mock       - Run mock NFS server"
