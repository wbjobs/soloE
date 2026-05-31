package scheduler

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"distributed-scheduler/models"
	"distributed-scheduler/queue"

	"github.com/google/uuid"
	"github.com/sirupsen/logrus"
	"gorm.io/gorm"
)

type Scheduler struct {
	db    *gorm.DB
	queue *queue.RedisPriorityQueue
	log   *logrus.Logger
}

func NewScheduler(db *gorm.DB, queue *queue.RedisPriorityQueue, log *logrus.Logger) *Scheduler {
	return &Scheduler{
		db:    db,
		queue: queue,
		log:   log,
	}
}

func (s *Scheduler) CreateDAG(ctx context.Context, def *DAGDefinition) (*models.DAG, error) {
	if err := s.ValidateDAG(ctx, def); err != nil {
		return nil, err
	}

	tx := s.db.Begin()
	if tx.Error != nil {
		return nil, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	dag := &models.DAG{
		Name:        def.Name,
		Description: def.Description,
		Status:      models.TaskStatusPending,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	if err := tx.Create(dag).Error; err != nil {
		tx.Rollback()
		return nil, err
	}

	taskIDMap := make(map[string]uuid.UUID)
	for _, taskDef := range def.Tasks {
		maxRetries := taskDef.MaxRetries
		if maxRetries <= 0 {
			maxRetries = 3
		}

		priority := models.TaskPriority(taskDef.Priority)
		if priority != models.PriorityHigh && priority != models.PriorityMedium && priority != models.PriorityLow {
			priority = models.PriorityMedium
		}

		task := &models.Task{
			DAGID:      dag.ID,
			Name:       taskDef.Name,
			Type:       taskDef.Type,
			Status:     models.TaskStatusPending,
			Priority:   priority,
			MaxRetries: maxRetries,
			Endpoint:   taskDef.Endpoint,
			Payload:    taskDef.Payload,
			CreatedAt:  time.Now(),
			UpdatedAt:  time.Now(),
		}

		if err := tx.Create(task).Error; err != nil {
			tx.Rollback()
			return nil, err
		}

		taskIDMap[taskDef.ID] = task.ID
	}

	for _, taskDef := range def.Tasks {
		taskID := taskIDMap[taskDef.ID]
		for _, depID := range taskDef.DependsOn {
			depUUID := taskIDMap[depID]
			dep := &models.TaskDependency{
				DAGID:     dag.ID,
				TaskID:    taskID,
				DependsOn: depUUID,
				CreatedAt: time.Now(),
			}
			if err := tx.Create(dep).Error; err != nil {
				tx.Rollback()
				return nil, err
			}
		}
	}

	if err := tx.Commit().Error; err != nil {
		return nil, err
	}

	return dag, nil
}

func (s *Scheduler) CheckDependencies(ctx context.Context, taskID uuid.UUID) (bool, error) {
	var deps []models.TaskDependency
	if err := s.db.Where("task_id = ?", taskID).Find(&deps).Error; err != nil {
		return false, err
	}

	if len(deps) == 0 {
		return true, nil
	}

	for _, dep := range deps {
		var depTask models.Task
		if err := s.db.Where("id = ?", dep.DependsOn).First(&depTask).Error; err != nil {
			return false, err
		}
		if depTask.Status != models.TaskStatusCompleted {
			return false, nil
		}
	}

	return true, nil
}

func (s *Scheduler) ScheduleReadyTasks(ctx context.Context, dagID uuid.UUID) error {
	var tasks []models.Task
	if err := s.db.Where("dag_id = ? AND status IN ?", dagID, []models.TaskStatus{
		models.TaskStatusPending,
		models.TaskStatusRetrying,
		models.TaskStatusResuming,
	}).Find(&tasks).Error; err != nil {
		return err
	}

	for _, task := range tasks {
		ready, err := s.CheckDependencies(ctx, task.ID)
		if err != nil {
			s.log.WithError(err).WithField("task_id", task.ID).Error("Failed to check dependencies")
			continue
		}

		if ready {
			if err := s.PublishTask(ctx, &task); err != nil {
				s.log.WithError(err).WithField("task_id", task.ID).Error("Failed to publish task")
				continue
			}

			task.Status = models.TaskStatusReady
			task.UpdatedAt = time.Now()
			if err := s.db.Save(&task).Error; err != nil {
				s.log.WithError(err).WithField("task_id", task.ID).Error("Failed to update task status")
			}
		}
	}

	return nil
}

func (s *Scheduler) PublishTask(ctx context.Context, task *models.Task) error {
	item := &queue.PriorityItem{
		TaskID:   task.ID,
		DAGID:    task.DAGID,
		Name:     task.Name,
		Type:     task.Type,
		Priority: task.Priority,
		Endpoint: task.Endpoint,
		Payload:  task.Payload,
		Retry:    task.RetryCount,
	}

	s.log.WithFields(logrus.Fields{
		"task_id":  task.ID,
		"priority": task.Priority,
	}).Info("Publishing task to queue")

	return s.queue.Push(ctx, item)
}

func (s *Scheduler) UpdateTaskStatus(ctx context.Context, taskID uuid.UUID, status models.TaskStatus, errMsg string) error {
	task := &models.Task{}
	if err := s.db.Where("id = ?", taskID).First(task).Error; err != nil {
		return err
	}

	task.Status = status
	task.UpdatedAt = time.Now()

	if status == models.TaskStatusRunning {
		now := time.Now()
		task.StartedAt = &now
	} else if status == models.TaskStatusCompleted || status == models.TaskStatusFailed {
		now := time.Now()
		task.FinishedAt = &now
	} else if status == models.TaskStatusPaused {
		now := time.Now()
		task.PausedAt = &now
	}

	if errMsg != "" {
		task.ErrorMsg = errMsg
	}

	if err := s.db.Save(task).Error; err != nil {
		return err
	}

	s.log.WithFields(logrus.Fields{
		"task_id": taskID,
		"status":  status,
	}).Info("Task status updated")

	return s.CheckDAGCompletion(ctx, task.DAGID)
}

func (s *Scheduler) PauseTask(ctx context.Context, taskID uuid.UUID, checkpointData interface{}) error {
	task := &models.Task{}
	if err := s.db.Where("id = ? AND status = ?", taskID, models.TaskStatusRunning).First(task).Error; err != nil {
		return err
	}

	task.Status = models.TaskStatusPaused
	now := time.Now()
	task.PausedAt = &now
	task.UpdatedAt = now

	if checkpointData != nil {
		data, err := json.Marshal(checkpointData)
		if err == nil {
			task.CheckpointData = string(data)
		}
	}

	if err := s.db.Save(task).Error; err != nil {
		return err
	}

	s.log.WithField("task_id", taskID).Info("Task paused")
	return nil
}

func (s *Scheduler) ResumeTask(ctx context.Context, taskID uuid.UUID) error {
	task := &models.Task{}
	if err := s.db.Where("id = ? AND status = ?", taskID, models.TaskStatusPaused).First(task).Error; err != nil {
		return err
	}

	task.Status = models.TaskStatusResuming
	task.UpdatedAt = time.Now()

	if err := s.db.Save(task).Error; err != nil {
		return err
	}

	if err := s.PublishTask(ctx, task); err != nil {
		return err
	}

	s.log.WithField("task_id", taskID).Info("Task resumed and republished to queue")
	return nil
}

func (s *Scheduler) GetTaskCheckpoint(ctx context.Context, taskID uuid.UUID) (string, error) {
	task := &models.Task{}
	if err := s.db.Where("id = ?", taskID).First(task).Error; err != nil {
		return "", err
	}
	return task.CheckpointData, nil
}

func (s *Scheduler) UpdateTaskProgress(ctx context.Context, taskID uuid.UUID, progress int) error {
	task := &models.Task{}
	if err := s.db.Where("id = ?", taskID).First(task).Error; err != nil {
		return err
	}

	task.Progress = progress
	task.UpdatedAt = time.Now()

	return s.db.Save(task).Error
}

func (s *Scheduler) CheckDAGCompletion(ctx context.Context, dagID uuid.UUID) error {
	var tasks []models.Task
	if err := s.db.Where("dag_id = ?", dagID).Find(&tasks).Error; err != nil {
		return err
	}

	allCompleted := true
	anyFailed := false

	for _, task := range tasks {
		if task.Status != models.TaskStatusCompleted {
			allCompleted = false
		}
		if task.Status == models.TaskStatusFailed {
			anyFailed = true
		}
	}

	dag := &models.DAG{}
	if err := s.db.Where("id = ?", dagID).First(dag).Error; err != nil {
		return err
	}

	if anyFailed {
		dag.Status = models.TaskStatusFailed
	} else if allCompleted {
		dag.Status = models.TaskStatusCompleted
	} else {
		dag.Status = models.TaskStatusRunning
	}
	dag.UpdatedAt = time.Now()

	return s.db.Save(dag).Error
}

func (s *Scheduler) GetDAG(ctx context.Context, dagID uuid.UUID) (*models.DAG, error) {
	dag := &models.DAG{}
	if err := s.db.Preload("Tasks").Where("id = ?", dagID).First(dag).Error; err != nil {
		return nil, err
	}
	return dag, nil
}

func (s *Scheduler) ListDAGs(ctx context.Context) ([]models.DAG, error) {
	var dags []models.DAG
	if err := s.db.Preload("Tasks").Find(&dags).Error; err != nil {
		return nil, err
	}
	return dags, nil
}

func (s *Scheduler) DB() *gorm.DB {
	return s.db
}

func (s *Scheduler) Queue() *queue.RedisPriorityQueue {
	return s.queue
}
