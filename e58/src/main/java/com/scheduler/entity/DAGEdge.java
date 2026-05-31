package com.scheduler.entity;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "dag_edges", indexes = {
    @Index(name = "idx_dag_edge_dag_id", columnList = "dag_id")
})
public class DAGEdge {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "dag_id", nullable = false)
    private String dagId;

    @Column(name = "from_task", nullable = false)
    private String fromTask;

    @Column(name = "to_task", nullable = false)
    private String toTask;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;
}
