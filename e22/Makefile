.PHONY: all build-app build-collector generate clean

all: build-app build-collector

build-app:
	@echo "Building Go HTTP service..."
	@cd app && go build -o app .

build-collector: generate
	@echo "Building eBPF collector..."
	@cd collector && go build -o collector .

generate:
	@echo "Generating eBPF Go bindings..."
	@cd collector && go generate

clean:
	@echo "Cleaning up..."
	@rm -f app/app
	@rm -f collector/collector
	@rm -f collector/bpf_*.go
	@rm -f collector/bpf_*.o
