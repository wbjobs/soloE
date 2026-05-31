package queue

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/go-redis/redis/v8"
	"github.com/google/uuid"
)

type TaskMessage struct {
	TaskID   uuid.UUID `json:"task_id"`
	DAGID    uuid.UUID `json:"dag_id"`
	Name     string    `json:"name"`
	Type     string    `json:"type"`
	Endpoint string    `json:"endpoint"`
	Payload  string    `json:"payload"`
	Retry    int       `json:"retry"`
}

type RedisQueue struct {
	client       *redis.Client
	streamName   string
	consumerGroup string
}

func NewRedisQueue(addr, password string, db int, streamName, consumerGroup string) *RedisQueue {
	client := redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: password,
		DB:       db,
	})

	return &RedisQueue{
		client:       client,
		streamName:   streamName,
		consumerGroup: consumerGroup,
	}
}

func (rq *RedisQueue) Ping(ctx context.Context) error {
	return rq.client.Ping(ctx).Err()
}

func (rq *RedisQueue) PublishTask(ctx context.Context, msg *TaskMessage) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("failed to marshal task message: %w", err)
	}

	_, err = rq.client.XAdd(ctx, &redis.XAddArgs{
		Stream: rq.streamName,
		Values: map[string]interface{}{
			"task_id":   msg.TaskID.String(),
			"dag_id":    msg.DAGID.String(),
			"name":      msg.Name,
			"type":      msg.Type,
			"endpoint":  msg.Endpoint,
			"payload":   msg.Payload,
			"retry":     msg.Retry,
			"data":      string(data),
		},
	}).Result()

	if err != nil {
		return fmt.Errorf("failed to publish task: %w", err)
	}

	return nil
}

func (rq *RedisQueue) CreateConsumerGroup(ctx context.Context) error {
	_, err := rq.client.XGroupCreateMkStream(ctx, rq.streamName, rq.consumerGroup, "0").Result()
	if err != nil && err.Error() != "BUSYGROUP Consumer Group name already exists" {
		return fmt.Errorf("failed to create consumer group: %w", err)
	}
	return nil
}

func (rq *RedisQueue) ConsumeTasks(ctx context.Context, consumerName string, count int64) ([]TaskMessage, []string, error) {
	streams, err := rq.client.XReadGroup(ctx, &redis.XReadGroupArgs{
		Group:    rq.consumerGroup,
		Consumer: consumerName,
		Streams:  []string{rq.streamName, ">"},
		Count:    count,
		Block:    5 * time.Second,
	}).Result()

	if err != nil {
		if err == redis.Nil {
			return nil, nil, nil
		}
		return nil, nil, fmt.Errorf("failed to read from stream: %w", err)
	}

	var messages []TaskMessage
	var messageIDs []string

	for _, stream := range streams {
		for _, msg := range stream.Messages {
			var taskMsg TaskMessage
			
			if dataStr, ok := msg.Values["data"].(string); ok {
				if err := json.Unmarshal([]byte(dataStr), &taskMsg); err != nil {
					continue
				}
				messages = append(messages, taskMsg)
				messageIDs = append(messageIDs, msg.ID)
			}
		}
	}

	return messages, messageIDs, nil
}

func (rq *RedisQueue) AckMessage(ctx context.Context, messageID string) error {
	_, err := rq.client.XAck(ctx, rq.streamName, rq.consumerGroup, messageID).Result()
	return err
}

func (rq *RedisQueue) Close() error {
	return rq.client.Close()
}
