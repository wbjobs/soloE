package com.scheduler.entity;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "shard_tasks")
public class ShardTask {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @Column(name = "parent_task_id", nullable = false)
    private String parentTaskId;

    @Column(name = "shard_index", nullable = false)
    private Integer shardIndex;

    @Column(name = "total_shards", nullable = false)
    private Integer totalShards;

    @Column(name = "shard_key")
    private String shardKey;

    @Column(columnDefinition = "TEXT")
    private String shardData;

    @Column(columnDefinition = "TEXT")
    private String result;

    @Column(name = "started_at")
    private LocalDateTime startedAt;

    @Column(name = "completed_at")
    private LocalDateTime completedAt;

    @Column(name = "worker_id")
    private String workerId;

    @Column(nullable = false)
    private String status;

    @Column(columnDefinition = "TEXT")
    private String errorMessage;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    @Version
    private Long version;
}
