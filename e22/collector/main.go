package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/cilium/ebpf"
	"github.com/cilium/ebpf/link"
)

//go:generate go run github.com/cilium/ebpf/cmd/bpf2go -cc clang -cflags "-O2 -g -Wall -Werror" bpf ../ebpf/profiler.bpf.c -- -I../ebpf

type ProfileStats struct {
	FunctionName string  `json:"function_name"`
	Count        uint64  `json:"count"`
	TotalNs      uint64  `json:"total_ns"`
	MinNs        uint64  `json:"min_ns"`
	MaxNs        uint64  `json:"max_ns"`
	AvgNs        float64 `json:"avg_ns"`
}

type ProfileResponse struct {
	Success bool          `json:"success"`
	Data    ProfileStats  `json:"data"`
	Message string        `json:"message,omitempty"`
}

var (
	objs    bpfObjects
	uprobe  link.Link
	uretprobe link.Link
)

func loadBpfProgram() error {
	spec, err := loadBpf()
	if err != nil {
		return fmt.Errorf("loading BPF spec: %w", err)
	}

	if err := spec.LoadAndAssign(&objs, nil); err != nil {
		return fmt.Errorf("loading BPF objects: %w", err)
	}

	return nil
}

func attachUprobe(binaryPath string) error {
	ex, err := link.OpenExecutable(binaryPath)
	if err != nil {
		return fmt.Errorf("opening executable: %w", err)
	}

	funcName := "net/http.(*ServeMux).ServeHTTP"

	uprobe, err = ex.Uprobe(funcName, objs.ServehttpEntry, nil)
	if err != nil {
		return fmt.Errorf("attaching uprobe to %s: %w", funcName, err)
	}

	uretprobe, err = ex.Uretprobe(funcName, objs.ServehttpExit, nil)
	if err != nil {
		return fmt.Errorf("attaching uretprobe to %s: %w", funcName, err)
	}

	fmt.Printf("Successfully attached probes to %s\n", funcName)
	return nil
}

func profileHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		json.NewEncoder(w).Encode(ProfileResponse{
			Success: false,
			Message: "Method not allowed",
		})
		return
	}

	noReset := r.URL.Query().Get("no_reset") == "true"
	reset := !noReset

	var funcID uint32 = 0
	var stats struct {
		Count   uint64
		TotalNs uint64
		MinNs   uint64
		MaxNs   uint64
	}

	if err := objs.StatsMap.Lookup(&funcID, &stats); err != nil {
		if err == ebpf.ErrKeyNotExist {
			json.NewEncoder(w).Encode(ProfileResponse{
				Success: true,
				Data: ProfileStats{
					FunctionName: "net/http.(*ServeMux).ServeHTTP",
					Count:        0,
					TotalNs:      0,
					MinNs:        0,
					MaxNs:        0,
					AvgNs:        0,
				},
			})
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(ProfileResponse{
			Success: false,
			Message: fmt.Sprintf("Error reading stats: %v", err),
		})
		return
	}

	var avgNs float64
	if stats.Count > 0 {
		avgNs = float64(stats.TotalNs) / float64(stats.Count)
	}

	if reset {
		if err := objs.StatsMap.Delete(&funcID); err != nil && err != ebpf.ErrKeyNotExist {
			log.Printf("Warning: Failed to reset stats map: %v", err)
		}
	}

	response := ProfileResponse{
		Success: true,
		Data: ProfileStats{
			FunctionName: "net/http.(*ServeMux).ServeHTTP",
			Count:        stats.Count,
			TotalNs:      stats.TotalNs,
			MinNs:        stats.MinNs,
			MaxNs:        stats.MaxNs,
			AvgNs:        avgNs,
		},
	}

	json.NewEncoder(w).Encode(response)
}

func cleanupStartTimesMap() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		var count int
		var keys []uint64

		iter := objs.StartTimes.Iterate()
		var key uint64
		var value uint64

		for iter.Next(&key, &value) {
			keys = append(keys, key)
			count++
		}

		cutoff := uint64(time.Now().Add(-10 * time.Minute).UnixNano())
		cleaned := 0

		for _, k := range keys {
			var startTime uint64
			if err := objs.StartTimes.Lookup(&k, &startTime); err == nil {
				if startTime < cutoff {
					if err := objs.StartTimes.Delete(&k); err == nil {
						cleaned++
					}
				}
			}
		}

		if cleaned > 0 {
			log.Printf("Cleaned %d stale entries from start_times map (total: %d)", cleaned, count)
		}
	}
}

func main() {
	binaryPath := flag.String("binary", "", "Path to the Go HTTP service binary")
	apiAddr := flag.String("api-addr", ":9090", "Address for the profile API server")
	flag.Parse()

	if *binaryPath == "" {
		absPath, err := filepath.Abs("../app/app")
		if err == nil {
			*binaryPath = absPath
		} else {
			log.Fatal("Please specify -binary flag with path to the Go service binary")
		}
	}

	if _, err := os.Stat(*binaryPath); os.IsNotExist(err) {
		log.Fatalf("Binary not found: %s", *binaryPath)
	}

	fmt.Println("Go HTTP Profiler Collector")
	fmt.Println("==========================")
	fmt.Printf("Target binary: %s\n", *binaryPath)
	fmt.Printf("API endpoint: http://localhost%s/api/v1/profile\n", *apiAddr)
	fmt.Println("  - Use ?no_reset=true to keep stats after reading")
	fmt.Println()

	if err := loadBpfProgram(); err != nil {
		log.Fatalf("Failed to load BPF program: %v", err)
	}
	defer objs.Close()

	if err := attachUprobe(*binaryPath); err != nil {
		log.Fatalf("Failed to attach uprobe: %v", err)
	}
	defer uprobe.Close()
	defer uretprobe.Close()

	go cleanupStartTimesMap()

	exePath, err := os.Executable()
	staticDir := "static"
	if err == nil {
		exeDir := filepath.Dir(exePath)
		if _, err := os.Stat(filepath.Join(exeDir, "static")); err == nil {
			staticDir = filepath.Join(exeDir, "static")
		} else if _, err := os.Stat("static"); err != nil {
			staticDir = "./collector/static"
		}
	}

	mux := http.NewServeMux()
	
	fs := http.FileServer(http.Dir(staticDir))
	mux.Handle("/", http.StripPrefix("/", fs))
	
	mux.HandleFunc("/api/v1/profile", profileHandler)

	go func() {
		fmt.Printf("\nProfile API server starting on %s\n", *apiAddr)
		if err := http.ListenAndServe(*apiAddr, mux); err != nil {
			log.Printf("API server error: %v", err)
		}
	}()

	fmt.Println("\nCollector is running. Press Ctrl+C to exit.")
	
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	<-sig

	fmt.Println("\nShutting down...")
}
