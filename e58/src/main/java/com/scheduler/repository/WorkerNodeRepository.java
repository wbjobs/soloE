package com.scheduler.repository;

import com.scheduler.entity.WorkerNode;
import com.scheduler.enums.WorkerStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;

@Repository
public interface WorkerNodeRepository extends JpaRepository<WorkerNode, String> {

    List<WorkerNode> findByStatus(WorkerStatus status);

    @Query("SELECT w FROM WorkerNode w WHERE w.lastHeartbeatAt < :timeout")
    List<WorkerNode> findUnresponsiveWorkers(@Param("timeout") LocalDateTime timeout);

    @Query("SELECT w FROM WorkerNode w WHERE w.status = 'ONLINE' AND w.currentTasks < w.maxTasks ORDER BY w.currentTasks ASC")
    List<WorkerNode> findAvailableWorkers();
}
