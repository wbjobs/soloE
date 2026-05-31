package worker

import (
	"context"
	"sync"

	"distributed-scheduler/models"
	"distributed-scheduler/queue"

	"github.com/google/uuid"
	"github.com/sirupsen/logrus"
)

type TaskExecution struct {
	TaskID    uuid.UUID
	Task      *queue.PriorityItem
	Ctx       context.Context
	Cancel    context.CancelFunc
	Priority  models.TaskPriority
	StartedAt int64
}

type ContextManager struct {
	runningTasks map[uuid.UUID]*TaskExecution
	mu           sync.RWMutex
	log          *logrus.Logger
	queue        *queue.RedisPriorityQueue
	db           interface{}
}

func NewContextManager(log *logrus.Logger, queue *queue.RedisPriorityQueue, db interface{}) *ContextManager {
	return &ContextManager{
		runningTasks: make(map[uuid.UUID]*TaskExecution),
		log:          log,
		queue:        queue,
		db:           db,
	}
}

func (cm *ContextManager) RegisterTask(task *queue.PriorityItem) (context.Context, context.CancelFunc) {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	ctx, cancel := context.WithCancel(context.Background())
	
	cm.runningTasks[task.TaskID] = &TaskExecution{
		TaskID:    task.TaskID,
		Task:      task,
		Ctx:       ctx,
		Cancel:    cancel,
		Priority:  task.Priority,
		StartedAt: 0,
	}

	cm.log.WithFields(logrus.Fields{
		"task_id":  task.TaskID,
		"priority": task.Priority,
	}).Debug("Task registered in context manager")

	return ctx, cancel
}

func (cm *ContextManager) UnregisterTask(taskID uuid.UUID) {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	if exec, exists := cm.runningTasks[taskID]; exists {
		exec.Cancel()
		delete(cm.runningTasks, taskID)
		cm.log.WithField("task_id", taskID).Debug("Task unregistered from context manager")
	}
}

func (cm *ContextManager) GetRunningTask(taskID uuid.UUID) *TaskExecution {
	cm.mu.RLock()
	defer cm.mu.RUnlock()
	
	return cm.runningTasks[taskID]
}

func (cm *ContextManager) GetRunningTasksByPriority(priority models.TaskPriority) []*TaskExecution {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	var tasks []*TaskExecution
	for _, exec := range cm.runningTasks {
		if exec.Priority == priority {
			tasks = append(tasks, exec)
		}
	}
	return tasks
}

func (cm *ContextManager) GetLowerPriorityTasks(threshold models.TaskPriority) []*TaskExecution {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	var tasks []*TaskExecution
	thresholdWeight := threshold.Weight()
	
	for _, exec := range cm.runningTasks {
		if exec.Priority.Weight() < thresholdWeight {
			tasks = append(tasks, exec)
		}
	}
	return tasks
}

func (cm *ContextManager) PreemptLowPriorityTasks(highPriorityCount int) int {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	var lowPriorityTasks []*TaskExecution
	for _, exec := range cm.runningTasks {
		if exec.Priority == models.PriorityLow || exec.Priority == models.PriorityMedium {
			lowPriorityTasks = append(lowPriorityTasks, exec)
		}
	}

	if len(lowPriorityTasks) == 0 {
		return 0
	}

	preemptedCount := 0
	maxPreempt := min(highPriorityCount, len(lowPriorityTasks))

	for i := 0; i < maxPreempt; i++ {
		task := lowPriorityTasks[i]
		cm.log.WithFields(logrus.Fields{
			"task_id":       task.TaskID,
			"task_priority": task.Priority,
		}).Info("Preempting low priority task for higher priority task")
		
		task.Cancel()
		preemptedCount++
	}

	return preemptedCount
}

func (cm *ContextManager) RunningCount() int {
	cm.mu.RLock()
	defer cm.mu.RUnlock()
	return len(cm.runningTasks)
}

func (cm *ContextManager) CancelAll() {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	for _, exec := range cm.runningTasks {
		exec.Cancel()
	}
	
	cm.runningTasks = make(map[uuid.UUID]*TaskExecution)
}

type PreemptionStrategy interface {
	ShouldPreempt(ctx context.Context, cm *ContextManager) (bool, int)
	Preempt(cm *ContextManager, count int) int
}

type GreedyPreemption struct{}

func (p *GreedyPreemption) ShouldPreempt(ctx context.Context, cm *ContextManager) (bool, int) {
	hasHigh, err := cm.queue.HasHighPriorityTasks(ctx)
	if err != nil {
		cm.log.WithError(err).Warn("Failed to check high priority tasks")
		return false, 0
	}
	
	if !hasHigh {
		return false, 0
	}
	
	lowTasks := cm.GetLowerPriorityTasks(models.PriorityHigh)
	return len(lowTasks) > 0, len(lowTasks)
}

func (p *GreedyPreemption) Preempt(cm *ContextManager, count int) int {
	return cm.PreemptLowPriorityTasks(count)
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
