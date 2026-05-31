package com.scheduler.repository;

import com.scheduler.entity.TaskInstance;
import com.scheduler.enums.TaskPriority;
import com.scheduler.enums.TaskStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Repository
public interface TaskInstanceRepository extends JpaRepository<TaskInstance, String> {

    List<TaskInstance> findByStatus(TaskStatus status);

    List<TaskInstance> findByDagId(String dagId);

    List<TaskInstance> findByWorkerIdAndStatus(String workerId, TaskStatus status);

    @Query("SELECT t FROM TaskInstance t WHERE t.status = 'RUNNING' AND t.workerId = :workerId")
    List<TaskInstance> findRunningTasksByWorkerId(@Param("workerId") String workerId);

    @Query("SELECT t FROM TaskInstance t WHERE t.status = 'PENDING' AND t.nextRetryAt <= :now ORDER BY t.priority DESC, t.createdAt ASC")
    List<TaskInstance> findReadyToRetryTasks(@Param("now") LocalDateTime now);

    @Query("SELECT t FROM TaskInstance t WHERE t.dagId = :dagId AND t.taskName = :taskName")
    Optional<TaskInstance> findByDagIdAndTaskName(@Param("dagId") String dagId, @Param("taskName") String taskName);

    @Query("SELECT COUNT(t) FROM TaskInstance t WHERE t.status = 'RUNNING' AND t.priority < :priority")
    long countRunningTasksWithLowerPriority(@Param("priority") TaskPriority priority);

    @Query("SELECT t FROM TaskInstance t WHERE t.status = 'RUNNING' " +
           "AND t.lastHeartbeatAt IS NOT NULL AND t.lastHeartbeatAt < :thresholdTime")
    List<TaskInstance> findOrphanTasks(@Param("thresholdTime") LocalDateTime thresholdTime);
}
