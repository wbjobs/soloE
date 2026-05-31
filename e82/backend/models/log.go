package models

type VoteLog struct {
	Term         int64  `json:"term"`
	VoteGranted  bool   `json:"vote_granted"`
	NodeID       string `json:"node_id"`
	Timestamp    int64  `json:"timestamp"`
	IsOffline    bool   `json:"is_offline,omitempty"`
	OfflineNode  string `json:"offline_node,omitempty"`
	AffectedBy   string `json:"affected_by,omitempty"`
}

type TermAnalysis struct {
	Term              int64             `json:"term"`
	Votes             map[string]int    `json:"votes"`
	TotalVotes        int               `json:"total_votes"`
	HasBrainSplit     bool              `json:"has_brain_split"`
	Winner            string            `json:"winner"`
	IsValid           bool              `json:"is_valid"`
	RiskLevel         string            `json:"risk_level"`
	AffectedByOffline bool              `json:"affected_by_offline"`
	OfflineNode       string            `json:"offline_node,omitempty"`
	OfflineVotes      map[string]int    `json:"offline_votes,omitempty"`
}

type AnalysisResult struct {
	Terms           []TermAnalysis `json:"terms"`
	TotalTerms      int            `json:"total_terms"`
	BrainSplitCnt   int            `json:"brain_split_count"`
	InvalidCnt      int            `json:"invalid_count"`
	RiskTerms       []int64        `json:"risk_terms"`
	OfflineSim      *OfflineSim    `json:"offline_sim,omitempty"`
}

type OfflineSim struct {
	OfflineNode   string  `json:"offline_node"`
	OfflineStart  int64   `json:"offline_start_term"`
	OfflineEnd    int64   `json:"offline_end_term"`
	AffectedTerms []int64 `json:"affected_terms"`
}

type SimulateConfig struct {
	NodeCount       int     `json:"node_count"`
	TermCount       int     `json:"term_count"`
	BrainSplitRate  float64 `json:"brain_split_rate"`
	OfflineNode     string  `json:"offline_node,omitempty"`
	OfflineDuration int     `json:"offline_duration,omitempty"`
	OfflineStartTerm int    `json:"offline_start_term,omitempty"`
}
