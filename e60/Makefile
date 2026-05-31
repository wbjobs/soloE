.PHONY: all build server client clean test

all: build

build: server client

server:
	go build -o bin/quic-server.exe ./cmd/server

client:
	go build -o bin/quic-client.exe ./cmd/client

clean:
	rm -rf bin/

run-server:
	go run ./cmd/server

run-client:
	go run ./cmd/client

test:
	go test ./...
