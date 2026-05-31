package main

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"runtime"
	"time"
)

type StatusResponse struct {
	Message string `json:"message"`
	Time    string `json:"time"`
}

func bubbleSort(arr []int) {
	n := len(arr)
	for i := 0; i < n-1; i++ {
		for j := 0; j < n-i-1; j++ {
			if arr[j] > arr[j+1] {
				arr[j], arr[j+1] = arr[j+1], arr[j]
			}
		}
	}
}

func generateRandomArray(size int) []int {
	arr := make([]int, size)
	for i := 0; i < size; i++ {
		arr[i] = rand.Intn(1000000)
	}
	return arr
}

func heavyCPUHandler(w http.ResponseWriter, r *http.Request) {
	size := 10000
	iterations := 10

	for i := 0; i < iterations; i++ {
		arr := generateRandomArray(size)
		bubbleSort(arr)
		runtime.Gosched()
	}

	response := StatusResponse{
		Message: "Heavy CPU task completed (bubble sorted 10 arrays of 10000 elements)",
		Time:    time.Now().Format(time.RFC3339),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func lightHandler(w http.ResponseWriter, r *http.Request) {
	response := StatusResponse{
		Message: "Light request handled",
		Time:    time.Now().Format(time.RFC3339),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func main() {
	mux := http.NewServeMux()

	mux.HandleFunc("/heavy", heavyCPUHandler)
	mux.HandleFunc("/light", lightHandler)

	fmt.Println("Go HTTP Profiling Service starting on :8080")
	fmt.Println("Endpoints:")
	fmt.Println("  GET /heavy  - Simulate high CPU usage")
	fmt.Println("  GET /light  - Lightweight request")

	if err := http.ListenAndServe(":8080", mux); err != nil {
		fmt.Printf("Server error: %v\n", err)
	}
}
