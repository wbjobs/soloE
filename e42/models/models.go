package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type TaskStatus string

const (
	TaskStatusPending    TaskStatus = "pending"
	TaskStatusReady      TaskStatus = "ready"
	TaskStatusRunning    TaskStatus = "running"
	TaskStatusPaused     TaskStatus = "paused"
	TaskStatusResuming   TaskStatus = "resuming"
	TaskStatusCompleted  TaskStatus = "completed"
	TaskStatusFailed     TaskStatus = "failed"
	TaskStatusRetrying   TaskStatus = "retrying"
)

type TaskPriority string

const (
	PriorityHigh   TaskPriority = "high"
	PriorityMedium TaskPriority = "medium"
	PriorityLow    TaskPriority = "low"
)

func (p TaskPriority) Weight() int {
	switch p {
	case PriorityHigh:
		return 3
	case PriorityMedium:
		return 2
	case PriorityLow:
		return 1
	default:
		return 2
	}
}

type DAG struct {
	ID          uuid.UUID      `gorm:"type:uuid;primaryKey" json:"id"`
	Name        string         `gorm:"type:varchar(255);not null" json:"name"`
	Description string         `gorm:"type:text" json:"description"`
	Status      TaskStatus     `gorm:"type:varchar(50);default:pending" json:"status"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	Tasks       []Task         `gorm:"foreignKey:DAGID" json:"tasks"`
}

type Task struct {
	ID             uuid.UUID    `gorm:"type:uuid;primaryKey" json:"id"`
	DAGID          uuid.UUID    `gorm:"type:uuid;not null" json:"dag_id"`
	Name           string       `gorm:"type:varchar(255);not null" json:"name"`
	Type           string       `gorm:"type:varchar(100);not null" json:"type"`
	Status         TaskStatus   `gorm:"type:varchar(50);default:pending" json:"status"`
	Priority       TaskPriority `gorm:"type:varchar(20);default:medium" json:"priority"`
	RetryCount     int          `gorm:"default:0" json:"retry_count"`
	MaxRetries     int          `gorm:"default:3" json:"max_retries"`
	Endpoint       string       `gorm:"type:varchar(500)" json:"endpoint"`
	Payload        string       `gorm:"type:text" json:"payload"`
	Progress       int          `gorm:"default:0" json:"progress"`
	CheckpointData string       `gorm:"type:text" json:"checkpoint_data"`
	CreatedAt      time.Time    `json:"created_at"`
	UpdatedAt      time.Time    `json:"updated_at"`
	StartedAt      *time.Time   `json:"started_at"`
	FinishedAt     *time.Time   `json:"finished_at"`
	PausedAt       *time.Time   `json:"paused_at"`
	ErrorMsg       string       `gorm:"type:text" json:"error_msg"`
}

type TaskDependency struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	DAGID     uuid.UUID `gorm:"type:uuid;not null" json:"dag_id"`
	TaskID    uuid.UUID `gorm:"type:uuid;not null" json:"task_id"`
	DependsOn uuid.UUID `gorm:"type:uuid;not null" json:"depends_on"`
	CreatedAt time.Time `json:"created_at"`
}

func (d *DAG) BeforeCreate(tx *gorm.DB) error {
	d.ID = uuid.New()
	return nil
}

func (t *Task) BeforeCreate(tx *gorm.DB) error {
	t.ID = uuid.New()
	return nil
}

func (td *TaskDependency) BeforeCreate(tx *gorm.DB) error {
	td.ID = uuid.New()
	return nil
}

func NewDB(dsn string) (*gorm.DB, error) {
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		return nil, err
	}

	err = db.AutoMigrate(&DAG{}, &Task{}, &TaskDependency{})
	if err != nil {
		return nil, err
	}

	return db, nil
}
