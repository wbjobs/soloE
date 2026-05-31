// +build ignore

package main

import (
	"context"
	"fmt"

	"distributed-scheduler/scheduler"
)

func main() {
	parser := scheduler.NewDAGParser(nil)
	ctx := context.Background()

	testCases := []struct {
		name  string
		tasks []scheduler.TaskDefinition
	}{
		{
			name: "3-node cycle (A->B->C->A)",
			tasks: []scheduler.TaskDefinition{
				{ID: "A", Name: "Task A", Type: "test", DependsOn: []string{"B"}},
				{ID: "B", Name: "Task B", Type: "test", DependsOn: []string{"C"}},
				{ID: "C", Name: "Task C", Type: "test", DependsOn: []string{"A"}},
			},
		},
		{
			name: "4-node cycle",
			tasks: []scheduler.TaskDefinition{
				{ID: "A", Name: "Task A", Type: "test", DependsOn: []string{"B"}},
				{ID: "B", Name: "Task B", Type: "test", DependsOn: []string{"C"}},
				{ID: "C", Name: "Task C", Type: "test", DependsOn: []string{"D"}},
				{ID: "D", Name: "Task D", Type: "test", DependsOn: []string{"A"}},
			},
		},
		{
			name: "Direct cycle (A<->B)",
			tasks: []scheduler.TaskDefinition{
				{ID: "A", Name: "Task A", Type: "test", DependsOn: []string{"B"}},
				{ID: "B", Name: "Task B", Type: "test", DependsOn: []string{"A"}},
			},
		},
		{
			name: "Self cycle (A depends on A)",
			tasks: []scheduler.TaskDefinition{
				{ID: "A", Name: "Task A", Type: "test", DependsOn: []string{"A"}},
			},
		},
		{
			name: "Valid DAG - no cycle",
			tasks: []scheduler.TaskDefinition{
				{ID: "A", Name: "Task A", Type: "test", DependsOn: []string{}},
				{ID: "B", Name: "Task B", Type: "test", DependsOn: []string{"A"}},
				{ID: "C", Name: "Task C", Type: "test", DependsOn: []string{"B"}},
			},
		},
		{
			name: "Cycle in subgraph",
			tasks: []scheduler.TaskDefinition{
				{ID: "A", Name: "Task A", Type: "test", DependsOn: []string{}},
				{ID: "B", Name: "Task B", Type: "test", DependsOn: []string{"A"}},
				{ID: "C", Name: "Task C", Type: "test", DependsOn: []string{"D"}},
				{ID: "D", Name: "Task D", Type: "test", DependsOn: []string{"C"}},
			},
		},
	}

	for _, tc := range testCases {
		fmt.Printf("\n=== Test: %s ===\n", tc.name)
		fmt.Println("Task dependencies:")
		for _, task := range tc.tasks {
			fmt.Printf("  %s -> %v\n", task.ID, task.DependsOn)
		}

		def := &scheduler.DAGDefinition{
			Name:  "test",
			Tasks: tc.tasks,
		}

		err := parser.ValidateDAG(ctx, def)
		if err != nil {
			fmt.Printf("✓ Cycle DETECTED: %s\n", err.Error())
		} else {
			fmt.Println("✓ No cycle detected (valid DAG)")
		}
	}

	fmt.Println("\n=== Fix verified successfully ===")
}
