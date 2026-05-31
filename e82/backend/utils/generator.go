package utils

import (
	"arbiter-log-analyzer/models"
	"math/rand"
	"time"
)

func GenerateSimulatedLogs(nodeCount int, termCount int, brainSplitRate float64, offlineNode string, offlineDuration int, offlineStartTerm int) []models.VoteLog {
	var logs []models.VoteLog
	nodeIDs := make([]string, nodeCount)
	for i := 0; i < nodeCount; i++ {
		nodeIDs[i] = string(rune('A' + i))
	}

	baseTime := time.Now().UnixNano() / int64(time.Millisecond)

	if offlineStartTerm <= 0 {
		offlineStartTerm = termCount / 2
	}
	offlineEndTerm := offlineStartTerm + offlineDuration - 1
	if offlineEndTerm > termCount {
		offlineEndTerm = termCount
	}

	for term := 1; term <= termCount; term++ {
		isOfflineTerm := offlineNode != "" && term >= offlineStartTerm && term <= offlineEndTerm

		effectiveBrainSplitRate := brainSplitRate
		if isOfflineTerm {
			effectiveBrainSplitRate = 0.8
		}

		hasBrainSplit := rand.Float64() < effectiveBrainSplitRate
		var leaders []string

		availableNodes := make([]string, 0)
		for _, n := range nodeIDs {
			if !isOfflineTerm || n != offlineNode {
				availableNodes = append(availableNodes, n)
			}
		}

		if hasBrainSplit && len(availableNodes) >= 2 {
			leaders = pickRandomNodes(availableNodes, 2)
		} else if len(availableNodes) > 0 {
			leaders = pickRandomNodes(availableNodes, 1)
		}

		termBaseTime := baseTime + int64(term*1000)
		logIndex := 0

		for _, nodeID := range nodeIDs {
			nodeIsOffline := isOfflineTerm && nodeID == offlineNode

			for _, leader := range leaders {
				voteGranted := false
				if nodeIsOffline {
					voteGranted = false
				} else if nodeID == leader {
					voteGranted = true
				} else {
					voteGranted = rand.Float64() < 0.7
				}

				logEntry := models.VoteLog{
					Term:        int64(term),
					VoteGranted: voteGranted,
					NodeID:      leader,
					Timestamp:   termBaseTime + int64(logIndex*10),
				}

				if isOfflineTerm {
					logEntry.AffectedBy = offlineNode
					if nodeIsOffline {
						logEntry.IsOffline = true
						logEntry.OfflineNode = offlineNode
					}
				}

				logs = append(logs, logEntry)
				logIndex++
			}
		}
	}

	return logs
}

func pickRandomNodes(nodeIDs []string, count int) []string {
	shuffled := make([]string, len(nodeIDs))
	copy(shuffled, nodeIDs)
	rand.Shuffle(len(shuffled), func(i, j int) {
		shuffled[i], shuffled[j] = shuffled[j], shuffled[i]
	})
	return shuffled[:count]
}

func AnalyzeLogs(logs []models.VoteLog) models.AnalysisResult {
	termMap := make(map[int64]map[string]int)
	termOfflineMap := make(map[int64]bool)
	termOfflineNodeMap := make(map[int64]string)
	offlineVotesMap := make(map[int64]map[string]int)
	var offlineNode string
	var minOfflineTerm, maxOfflineTerm int64

	for _, log := range logs {
		if log.AffectedBy != "" && offlineNode == "" {
			offlineNode = log.AffectedBy
		}
		if log.IsOffline {
			termOfflineMap[log.Term] = true
			termOfflineNodeMap[log.Term] = log.OfflineNode
			if minOfflineTerm == 0 || log.Term < minOfflineTerm {
				minOfflineTerm = log.Term
			}
			if log.Term > maxOfflineTerm {
				maxOfflineTerm = log.Term
			}
		}
		if log.VoteGranted {
			if _, exists := termMap[log.Term]; !exists {
				termMap[log.Term] = make(map[string]int)
			}
			termMap[log.Term][log.NodeID]++
		} else if log.IsOffline {
			if _, exists := offlineVotesMap[log.Term]; !exists {
				offlineVotesMap[log.Term] = make(map[string]int)
			}
			offlineVotesMap[log.Term][log.NodeID]++
		}
	}

	var terms []models.TermAnalysis
	brainSplitCount := 0
	invalidCount := 0
	var riskTerms []int64
	var affectedTerms []int64

	for term, votes := range termMap {
		totalVotes := 0
		for _, count := range votes {
			totalVotes += count
		}

		var winner string
		maxVotes := 0
		multipleWinners := false

		for node, count := range votes {
			if count > maxVotes {
				maxVotes = count
				winner = node
				multipleWinners = false
			} else if count == maxVotes {
				multipleWinners = true
			}
		}

		hasBrainSplit := len(votes) > 1 && multipleWinners
		isValid := !hasBrainSplit && winner != ""

		riskLevel := "normal"
		if hasBrainSplit {
			riskLevel = "critical"
		} else if !isValid {
			riskLevel = "warning"
		}

		if hasBrainSplit {
			brainSplitCount++
			riskTerms = append(riskTerms, term)
		}
		if !isValid {
			invalidCount++
		}

		affectedByOffline := termOfflineMap[term]
		if affectedByOffline {
			affectedTerms = append(affectedTerms, term)
		}

		termAnalysis := models.TermAnalysis{
			Term:              term,
			Votes:             votes,
			TotalVotes:        totalVotes,
			HasBrainSplit:     hasBrainSplit,
			Winner:            winner,
			IsValid:           isValid,
			RiskLevel:         riskLevel,
			AffectedByOffline: affectedByOffline,
			OfflineNode:       termOfflineNodeMap[term],
		}

		if offlineVotes, ok := offlineVotesMap[term]; ok {
			termAnalysis.OfflineVotes = offlineVotes
		}

		terms = append(terms, termAnalysis)
	}

	result := models.AnalysisResult{
		Terms:         terms,
		TotalTerms:    len(terms),
		BrainSplitCnt: brainSplitCount,
		InvalidCnt:    invalidCount,
		RiskTerms:     riskTerms,
	}

	if offlineNode != "" {
		result.OfflineSim = &models.OfflineSim{
			OfflineNode:   offlineNode,
			OfflineStart:  minOfflineTerm,
			OfflineEnd:    maxOfflineTerm,
			AffectedTerms: affectedTerms,
		}
	}

	return result
}
