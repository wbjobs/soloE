package scheduler

import (
	"context"
	"testing"
)

func TestHasCycle(t *testing.T) {
	tests := []struct {
		name     string
		tasks    []TaskDefinition
		expected bool
	}{
		{
			name: "no cycle - simple chain",
			tasks: []TaskDefinition{
				{ID: "A", DependsOn: []string{}},
				{ID: "B", DependsOn: []string{"A"}},
				{ID: "C", DependsOn: []string{"B"}},
			},
			expected: false,
		},
		{
			name: "direct cycle - A depends on B, B depends on A",
			tasks: []TaskDefinition{
				{ID: "A", DependsOn: []string{"B"}},
				{ID: "B", DependsOn: []string{"A"}},
			},
			expected: true,
		},
		{
			name: "3-node cycle - A->B->C->A",
			tasks: []TaskDefinition{
				{ID: "A", DependsOn: []string{"B"}},
				{ID: "B", DependsOn: []string{"C"}},
				{ID: "C", DependsOn: []string{"A"}},
			},
			expected: true,
		},
		{
			name: "4-node cycle - A->B->C->D->A",
			tasks: []TaskDefinition{
				{ID: "A", DependsOn: []string{"B"}},
				{ID: "B", DependsOn: []string{"C"}},
				{ID: "C", DependsOn: []string{"D"}},
				{ID: "D", DependsOn: []string{"A"}},
			},
			expected: true,
		},
		{
			name: "cycle in subgraph",
			tasks: []TaskDefinition{
				{ID: "A", DependsOn: []string{}},
				{ID: "B", DependsOn: []string{"A"}},
				{ID: "C", DependsOn: []string{"D"}},
				{ID: "D", DependsOn: []string{"C"}},
			},
			expected: true,
		},
		{
			name: "self cycle - A depends on A",
			tasks: []TaskDefinition{
				{ID: "A", DependsOn: []string{"A"}},
			},
			expected: true,
		},
		{
			name: "complex DAG with no cycle (ml pipeline example)",
			tasks: []TaskDefinition{
				{ID: "data_collect_1", DependsOn: []string{}},
				{ID: "data_collect_2", DependsOn: []string{}},
				{ID: "data_clean_1", DependsOn: []string{"data_collect_1"}},
				{ID: "data_clean_2", DependsOn: []string{"data_collect_2"}},
				{ID: "feature_extract_1", DependsOn: []string{"data_clean_1"}},
				{ID: "feature_extract_2", DependsOn: []string{"data_clean_2"}},
				{ID: "feature_merge", DependsOn: []string{"feature_extract_1", "feature_extract_2"}},
				{ID: "model_train_1", DependsOn: []string{"feature_merge"}},
				{ID: "model_train_2", DependsOn: []string{"feature_merge"}},
				{ID: "result_aggregation", DependsOn: []string{"model_train_1", "model_train_2"}},
			},
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, _ := hasCycle(tt.tasks)
			if result != tt.expected {
				t.Errorf("hasCycle() = %v, expected %v", result, tt.expected)
			}
		})
	}
}

func TestValidateDAG(t *testing.T) {
	parser := NewDAGParser(nil)
	ctx := context.Background()

	tests := []struct {
		name        string
		def         *DAGDefinition
		expectError bool
	}{
		{
			name: "3-node cycle should be detected",
			def: &DAGDefinition{
				Name: "test",
				Tasks: []TaskDefinition{
					{ID: "A", Name: "Task A", Type: "test", DependsOn: []string{"B"}},
					{ID: "B", Name: "Task B", Type: "test", DependsOn: []string{"C"}},
					{ID: "C", Name: "Task C", Type: "test", DependsOn: []string{"A"}},
				},
			},
			expectError: true,
		},
		{
			name: "valid DAG should pass",
			def: &DAGDefinition{
				Name: "test",
				Tasks: []TaskDefinition{
					{ID: "A", Name: "Task A", Type: "test", DependsOn: []string{}},
					{ID: "B", Name: "Task B", Type: "test", DependsOn: []string{"A"}},
				},
			},
			expectError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := parser.ValidateDAG(ctx, tt.def)
			if (err != nil) != tt.expectError {
				t.Errorf("ValidateDAG() error = %v, expectError %v", err, tt.expectError)
			}
		})
	}
}

func TestCyclePathDetection(t *testing.T) {
	tests := []struct {
		name           string
		tasks          []TaskDefinition
		shouldHaveCycle bool
	}{
		{
			name: "3-node cycle A->B->C->A",
			tasks: []TaskDefinition{
				{ID: "A", DependsOn: []string{"B"}},
				{ID: "B", DependsOn: []string{"C"}},
				{ID: "C", DependsOn: []string{"A"}},
			},
			shouldHaveCycle: true,
		},
		{
			name: "4-node cycle",
			tasks: []TaskDefinition{
				{ID: "A", DependsOn: []string{"B"}},
				{ID: "B", DependsOn: []string{"C"}},
				{ID: "C", DependsOn: []string{"D"}},
				{ID: "D", DependsOn: []string{"A"}},
			},
			shouldHaveCycle: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			hasCycle, path := hasCycle(tt.tasks)
			if hasCycle != tt.shouldHaveCycle {
				t.Errorf("hasCycle() = %v, expected %v", hasCycle, tt.shouldHaveCycle)
			}
			if tt.shouldHaveCycle && len(path) == 0 {
				t.Error("cycle path should not be empty when cycle exists")
			}
			t.Logf("Cycle path: %v", path)
		})
	}
}
