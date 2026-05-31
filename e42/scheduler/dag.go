package scheduler

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type TaskDefinition struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Type       string   `json:"type"`
	Endpoint   string   `json:"endpoint"`
	Payload    string   `json:"payload"`
	DependsOn  []string `json:"depends_on"`
	MaxRetries int      `json:"max_retries"`
	Priority   string   `json:"priority"`
}

type DAGDefinition struct {
	Name        string           `json:"name"`
	Description string           `json:"description"`
	Tasks       []TaskDefinition `json:"tasks"`
}

type DAGParser struct {
	db *gorm.DB
}

func NewDAGParser(db *gorm.DB) *DAGParser {
	return &DAGParser{db: db}
}

func (p *DAGParser) ValidateDAG(ctx context.Context, def *DAGDefinition) error {
	if len(def.Tasks) == 0 {
		return fmt.Errorf("DAG must contain at least one task")
	}

	taskMap := make(map[string]bool)
	for _, task := range def.Tasks {
		if task.ID == "" {
			return fmt.Errorf("task must have an ID")
		}
		if task.Name == "" {
			return fmt.Errorf("task %s must have a name", task.ID)
		}
		if task.Type == "" {
			return fmt.Errorf("task %s must have a type", task.ID)
		}
		taskMap[task.ID] = true
	}

	for _, task := range def.Tasks {
		for _, dep := range task.DependsOn {
			if !taskMap[dep] {
				return fmt.Errorf("task %s depends on non-existent task %s", task.ID, dep)
			}
		}
	}

	hasCycleResult, cyclePath := hasCycle(def.Tasks)
	if hasCycleResult {
		if len(cyclePath) > 0 {
			cycleStr := ""
			for i, node := range cyclePath {
				if i > 0 {
					cycleStr += " -> "
				}
				cycleStr += node
			}
			return fmt.Errorf("DAG contains a cycle: %s", cycleStr)
		}
		return fmt.Errorf("DAG contains a cycle")
	}

	return nil
}

func hasCycle(tasks []TaskDefinition) (bool, []string) {
	inDegree := make(map[string]int)
	graph := make(map[string][]string)

	for _, task := range tasks {
		if _, ok := inDegree[task.ID]; !ok {
			inDegree[task.ID] = 0
		}
		for _, dep := range task.DependsOn {
			inDegree[task.ID]++
			graph[dep] = append(graph[dep], task.ID)
		}
	}

	queue := []string{}
	for taskID, degree := range inDegree {
		if degree == 0 {
			queue = append(queue, taskID)
		}
	}

	processedCount := 0
	for len(queue) > 0 {
		node := queue[0]
		queue = queue[1:]
		processedCount++

		for _, neighbor := range graph[node] {
			inDegree[neighbor]--
			if inDegree[neighbor] == 0 {
				queue = append(queue, neighbor)
			}
		}
	}

	hasCycle := processedCount != len(tasks)
	if !hasCycle {
		return false, nil
	}

	cyclePath := findCyclePath(tasks, graph)
	return true, cyclePath
}

func findCyclePath(tasks []TaskDefinition, graph map[string][]string) []string {
	remaining := make(map[string]bool)
	inDegree := make(map[string]int)
	
	for _, task := range tasks {
		remaining[task.ID] = true
		inDegree[task.ID] = 0
	}
	
	for _, task := range tasks {
		for _, dep := range task.DependsOn {
			inDegree[task.ID]++
		}
	}

	queue := []string{}
	for taskID, degree := range inDegree {
		if degree == 0 {
			queue = append(queue, taskID)
		}
	}

	for len(queue) > 0 {
		node := queue[0]
		queue = queue[1:]
		delete(remaining, node)

		for _, neighbor := range graph[node] {
			inDegree[neighbor]--
			if inDegree[neighbor] == 0 {
				queue = append(queue, neighbor)
			}
		}
	}

	for node := range remaining {
		path := []string{}
		visited := make(map[string]bool)
		if cycle := dfsFindCycle(node, graph, visited, path, remaining); cycle != nil {
			return cycle
		}
	}

	return nil
}

func dfsFindCycle(node string, graph map[string][]string, visited map[string]bool, path []string, remaining map[string]bool) []string {
	visited[node] = true
	path = append(path, node)

	for _, neighbor := range graph[node] {
		if !remaining[neighbor] {
			continue
		}

		if !visited[neighbor] {
			if result := dfsFindCycle(neighbor, graph, visited, path, remaining); result != nil {
				return result
			}
		} else {
			for i, n := range path {
				if n == neighbor {
					return append(path[i:], neighbor)
				}
			}
		}
	}

	path = path[:len(path)-1]
	return nil
}
