package analyzer

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

type ContributorStats struct {
	Name         string `json:"name"`
	Email        string `json:"email"`
	Commits      int    `json:"commits"`
	LinesAdded   int    `json:"lines_added"`
	LinesDeleted int    `json:"lines_deleted"`
}

type TimeStats struct {
	Weekday  map[string]int `json:"weekday"`
	Hour     map[string]int `json:"hour"`
	MostActiveWeekday string `json:"most_active_weekday"`
	MostActiveHour    string `json:"most_active_hour"`
}

type AnalysisResult struct {
	Contributors []ContributorStats `json:"contributors"`
	TimeStats    TimeStats          `json:"time_stats"`
}

func RunGitCommand(repoPath string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir, _ = filepath.Abs(repoPath)
	
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	
	err := cmd.Run()
	if err != nil {
		return "", fmt.Errorf("git command failed: %v, stderr: %s", err, stderr.String())
	}
	
	return stdout.String(), nil
}

func IsMergeCommit(repoPath, commitHash string) bool {
	_, err := RunGitCommand(repoPath, "rev-parse", "--verify", commitHash+"^2")
	return err == nil
}

func AnalyzeRepository(repoPath string, since string) (*AnalysisResult, error) {
	contributorMap := make(map[string]*ContributorStats)
	weekdayCount := make(map[string]int)
	hourCount := make(map[string]int)
	
	for i := 0; i < 7; i++ {
		weekdayCount[time.Weekday(i).String()] = 0
	}
	for i := 0; i < 24; i++ {
		hourCount[fmt.Sprintf("%02d:00", i)] = 0
	}
	
	args := []string{"log", "--pretty=format:%H|%an|%ae|%ad", "--date=iso"}
	if since != "" {
		args = append(args, "--since="+since)
	}
	
	output, err := RunGitCommand(repoPath, args...)
	if err != nil {
		return nil, err
	}
	
	lines := strings.Split(output, "\n")
	for _, line := range lines {
		if line == "" {
			continue
		}
		
		parts := strings.SplitN(line, "|", 4)
		if len(parts) != 4 {
			continue
		}
		
		commitHash := parts[0]
		name := parts[1]
		email := parts[2]
		dateStr := parts[3]
		
		key := name + " <" + email + ">"
		if _, exists := contributorMap[key]; !exists {
			contributorMap[key] = &ContributorStats{
				Name:  name,
				Email: email,
			}
		}
		contributorMap[key].Commits++
		
		commitTime, err := time.Parse("2006-01-02 15:04:05 -0700", dateStr)
		if err == nil {
			weekday := commitTime.Weekday().String()
			weekdayCount[weekday]++
			hourKey := fmt.Sprintf("%02d:00", commitTime.Hour())
			hourCount[hourKey]++
		}
		
		if !IsMergeCommit(repoPath, commitHash) {
			statOutput, _ := RunGitCommand(repoPath, "show", "--numstat", "--pretty=format:", commitHash)
			statLines := strings.Split(statOutput, "\n")
			for _, statLine := range statLines {
				if statLine == "" || strings.HasPrefix(statLine, "-") {
					continue
				}
				statParts := strings.Fields(statLine)
				if len(statParts) >= 2 {
					if added, err := strconv.Atoi(statParts[0]); err == nil {
						contributorMap[key].LinesAdded += added
					}
					if deleted, err := strconv.Atoi(statParts[1]); err == nil {
						contributorMap[key].LinesDeleted += deleted
					}
				}
			}
		}
	}
	
	contributors := make([]ContributorStats, 0, len(contributorMap))
	for _, stats := range contributorMap {
		contributors = append(contributors, *stats)
	}
	
	sort.Slice(contributors, func(i, j int) bool {
		return contributors[i].Commits > contributors[j].Commits
	})
	
	mostActiveWeekday := findMaxKey(weekdayCount)
	mostActiveHour := findMaxKey(hourCount)
	
	result := &AnalysisResult{
		Contributors: contributors,
		TimeStats: TimeStats{
			Weekday:             weekdayCount,
			Hour:                hourCount,
			MostActiveWeekday:   mostActiveWeekday,
			MostActiveHour:      mostActiveHour,
		},
	}
	
	return result, nil
}

func findMaxKey(m map[string]int) string {
	maxKey := ""
	maxValue := -1
	for key, value := range m {
		if value > maxValue {
			maxValue = value
			maxKey = key
		}
	}
	return maxKey
}

func (r *AnalysisResult) ToJSON() (string, error) {
	data, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		return "", err
	}
	return string(data), nil
}
