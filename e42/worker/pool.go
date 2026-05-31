package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"distributed-scheduler/models"
	"distributed-scheduler/queue"
	"distributed-scheduler/scheduler"

	"github.com/google/uuid"
	"github.com/sirupsen/logrus"
)

type WorkerPool struct {
	scheduler      *scheduler.Scheduler
	log            *logrus.Logger
	maxWorkers     int
	ctxManager     *ContextManager
	ctx            context.Context
	cancel         context.CancelFunc
	wg             sync.WaitGroup
	running        bool
	preemption     PreemptionStrategy
	preemptCheck   *time.Ticker
}

func NewWorkerPool(
	scheduler *scheduler.Scheduler,
	log *logrus.Logger,
	maxWorkers int,
) *WorkerPool {
	ctx, cancel := context.WithCancel(context.Background())
	
	return &WorkerPool{
		scheduler:    scheduler,
		log:          log,
		maxWorkers:   maxWorkers,
		ctx:          ctx,
		cancel:       cancel,
		preemption:   &GreedyPreemption{},
		preemptCheck: time.NewTicker(500 * time.Millisecond),
	}
}

func (wp *WorkerPool) Start(ctx context.Context) error {
	wp.ctxManager = NewContextManager(wp.log, wp.scheduler.Queue(), wp.scheduler.DB())
	wp.running = true

	wp.log.WithField("workers", wp.maxWorkers).Info("Worker pool started")

	go wp.preemptionLoop(ctx)

	for i := 0; i < wp.maxWorkers; i++ {
		wp.wg.Add(1)
		go wp.workerLoop(i)
	}

	<-ctx.Done()
	wp.Stop()
	
	return nil
}

func (wp *WorkerPool) preemptionLoop(ctx context.Context) {
	for {
		select {
		case <-wp.preemptCheck.C:
			shouldPreempt, count := wp.preemption.ShouldPreempt(ctx, wp.ctxManager)
			if shouldPreempt {
				wp.log.WithField("preempt_count", count).Info("Preempting low priority tasks")
				wp.preemption.Preempt(wp.ctxManager, count)
			}
		case <-ctx.Done():
			return
		}
	}
}

func (wp *WorkerPool) workerLoop(workerID int) {
	defer wp.wg.Done()
	
	log := wp.log.WithField("worker_id", workerID)
	log.Debug("Worker started")

	for {
		select {
		case <-wp.ctx.Done():
			log.Debug("Worker shutting down")
			return
		default:
			task, err := wp.scheduler.Queue().BPop(wp.ctx, 1*time.Second)
			if err != nil {
				log.WithError(err).Error("Failed to pop task from queue")
				time.Sleep(1 * time.Second)
				continue
			}
			
			if task == nil {
				continue
			}

			log.WithFields(logrus.Fields{
				"task_id":  task.TaskID,
				"priority": task.Priority,
				"name":     task.Name,
			}).Info("Processing task")

			if err := wp.processTask(task); err != nil {
				log.WithError(err).WithField("task_id", task.TaskID).Error("Task processing failed")
				
				if err := wp.handleTaskFailure(wp.ctx, task); err != nil {
					log.WithError(err).WithField("task_id", task.TaskID).Error("Failed to handle task failure")
				}
			}
		}
	}
}

func (wp *WorkerPool) processTask(task *queue.PriorityItem) error {
	ctx, cancel := wp.ctxManager.RegisterTask(task)
	defer wp.ctxManager.UnregisterTask(task.TaskID)
	defer cancel()

	if err := wp.scheduler.UpdateTaskStatus(wp.ctx, task.TaskID, models.TaskStatusRunning, ""); err != nil {
		return fmt.Errorf("failed to update task status: %w", err)
	}

	resultChan := make(chan error, 1)
	go func() {
		resultChan <- wp.executeTask(ctx, task)
	}()

	select {
	case err := <-resultChan:
		if err != nil {
			return err
		}
	case <-ctx.Done():
		wp.log.WithField("task_id", task.TaskID).Info("Task was preempted, saving checkpoint")
		
		checkpoint := map[string]interface{}{
			"phase":  "interrupted",
			"reason": "preempted_by_higher_priority_task",
			"time":   time.Now().Unix(),
		}
		
		if err := wp.scheduler.PauseTask(wp.ctx, task.TaskID, checkpoint); err != nil {
			wp.log.WithError(err).Error("Failed to save paused task state")
		}
		
		go func() {
			time.Sleep(3 * time.Second)
			if err := wp.scheduler.ResumeTask(wp.ctx, task.TaskID); err != nil {
				wp.log.WithError(err).Error("Failed to auto-resume task")
			}
		}()
		
		return fmt.Errorf("task preempted: %w", ctx.Err())
	}

	if err := wp.scheduler.UpdateTaskStatus(wp.ctx, task.TaskID, models.TaskStatusCompleted, ""); err != nil {
		return fmt.Errorf("failed to update task status to completed: %w", err)
	}

	go func() {
		time.Sleep(100 * time.Millisecond)
		wp.scheduler.ScheduleReadyTasks(context.Background(), task.DAGID)
	}()

	wp.log.WithField("task_id", task.TaskID).Info("Task completed successfully")
	return nil
}

func (wp *WorkerPool) executeTask(ctx context.Context, task *queue.PriorityItem) error {
	checkpointData, err := wp.scheduler.GetTaskCheckpoint(ctx, task.TaskID)
	if err != nil {
		wp.log.WithError(err).Warn("Failed to get checkpoint data")
	}
	
	if checkpointData != "" {
		wp.log.WithFields(logrus.Fields{
			"task_id": task.TaskID,
			"checkpoint": checkpointData,
		}).Info("Resuming task from checkpoint")
	}

	if task.Endpoint == "" {
		wp.log.WithField("task_id", task.TaskID).Info("No endpoint specified, simulating task execution")
		for i := 0; i <= 10; i++ {
			select {
			case <-ctx.Done():
				return ctx.Err()
			default:
				time.Sleep(200 * time.Millisecond)
				wp.scheduler.UpdateTaskProgress(ctx, task.TaskID, i*10)
			}
		}
		return nil
	}

	payload := map[string]interface{}{
		"task_id":    task.TaskID.String(),
		"dag_id":     task.DAGID.String(),
		"name":       task.Name,
		"type":       task.Type,
		"data":       task.Payload,
		"retry":      task.Retry,
		"checkpoint": checkpointData,
		"timestamp":  time.Now().Unix(),
	}

	jsonPayload, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal payload: %w", err)
	}

	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	req, err := http.NewRequestWithContext(ctx, "POST", task.Endpoint, bytes.NewBuffer(jsonPayload))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Task-ID", task.TaskID.String())

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("external service returned error status: %d", resp.StatusCode)
	}

	wp.log.WithFields(logrus.Fields{
		"task_id":  task.TaskID,
		"endpoint": task.Endpoint,
		"status":   resp.StatusCode,
	}).Info("External service called successfully")

	return nil
}

func (wp *WorkerPool) handleTaskFailure(ctx context.Context, task *queue.PriorityItem) error {
	taskModel := &models.Task{}
	if err := wp.scheduler.DB().Where("id = ?", task.TaskID).First(taskModel).Error; err != nil {
		return fmt.Errorf("failed to find task: %w", err)
	}

	if ctx.Err() != nil {
		wp.log.WithField("task_id", task.TaskID).Info("Task was preempted, will be resumed automatically")
		return nil
	}

	taskModel.RetryCount++
	taskModel.UpdatedAt = time.Now()

	if taskModel.RetryCount < taskModel.MaxRetries {
		taskModel.Status = models.TaskStatusRetrying
		if err := wp.scheduler.DB().Save(taskModel).Error; err != nil {
			return fmt.Errorf("failed to update task retry count: %w", err)
		}

		wp.log.WithFields(logrus.Fields{
			"task_id":   task.TaskID,
			"retry":     taskModel.RetryCount,
			"max_retries": taskModel.MaxRetries,
		}).Info("Task scheduled for retry")

		go func() {
			time.Sleep(5 * time.Second)
			wp.scheduler.ScheduleReadyTasks(context.Background(), task.DAGID)
		}()

		return nil
	}

	taskModel.Status = models.TaskStatusFailed
	taskModel.ErrorMsg = fmt.Sprintf("Task failed after %d retries", taskModel.MaxRetries)
	if err := wp.scheduler.DB().Save(taskModel).Error; err != nil {
		return fmt.Errorf("failed to update task status to failed: %w", err)
	}

	wp.log.WithFields(logrus.Fields{
		"task_id": task.TaskID,
		"retries": taskModel.MaxRetries,
	}).Error("Task failed after maximum retries")

	wp.scheduler.CheckDAGCompletion(ctx, task.DAGID)

	return nil
}

func (wp *WorkerPool) Stop() {
	if !wp.running {
		return
	}
	
	wp.log.Info("Worker pool stopping...")
	wp.cancel()
	wp.ctxManager.CancelAll()
	wp.preemptCheck.Stop()
	wp.wg.Wait()
	wp.running = false
	wp.log.Info("Worker pool stopped")
}
