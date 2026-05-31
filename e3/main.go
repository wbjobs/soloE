package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"git-analyzer/analyzer"
)

func main() {
	since := flag.String("since", "", "Only analyze commits since the specified date (e.g., '2024-01-01' or '2 weeks ago')")
	
	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "Usage: %s [options] <path-to-git-repo>\n", os.Args[0])
		fmt.Fprintf(os.Stderr, "\nOptions:\n")
		flag.PrintDefaults()
	}
	
	flag.Parse()
	
	if flag.NArg() < 1 {
		flag.Usage()
		os.Exit(1)
	}

	repoPath := flag.Arg(0)

	absPath, err := filepath.Abs(repoPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error resolving path: %v\n", err)
		os.Exit(1)
	}

	if _, err := os.Stat(filepath.Join(absPath, ".git")); os.IsNotExist(err) {
		fmt.Fprintf(os.Stderr, "Error: %s is not a valid Git repository\n", absPath)
		os.Exit(1)
	}

	result, err := analyzer.AnalyzeRepository(absPath, *since)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error analyzing repository: %v\n", err)
		os.Exit(1)
	}

	jsonOutput, err := result.ToJSON()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error generating JSON: %v\n", err)
		os.Exit(1)
	}

	fmt.Println(jsonOutput)
}
