package com.scheduler.entity;

import com.scheduler.enums.WorkerStatus;
import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "worker_nodes")
public class WorkerNode {

    @Id
    @Column(nullable = false, unique = true)
    private String id;

    private String hostname;

    private String ipAddress;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private WorkerStatus status;

    @Column(name = "current_tasks")
    private Integer currentTasks = 0;

    @Column(name = "max_tasks", nullable = false)
    private Integer maxTasks = 5;

    @Column(name = "last_heartbeat_at")
    private LocalDateTime lastHeartbeatAt;

    @CreationTimestamp
    @Column(name = "registered_at", nullable = false, updatable = false)
    private LocalDateTime registeredAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;
}
