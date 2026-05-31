package com.scheduler.repository;

import com.scheduler.entity.ShardTask;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface ShardTaskRepository extends JpaRepository<ShardTask, String> {

    List<ShardTask> findByParentTaskId(String parentTaskId);

    @Query("SELECT s FROM ShardTask s WHERE s.parentTaskId = :parentTaskId AND s.status IN (:statuses)")
    List<ShardTask> findByParentTaskIdAndStatusIn(@Param("parentTaskId") String parentTaskId,
                                                    @Param("statuses") List<String> statuses);

    @Query("SELECT COUNT(s) FROM ShardTask s WHERE s.parentTaskId = :parentTaskId AND s.status = :status")
    long countByParentTaskIdAndStatus(@Param("parentTaskId") String parentTaskId, @Param("status") String status);

    @Query("SELECT DISTINCT s.parentTaskId FROM ShardTask s WHERE s.status IN ('RUNNING', 'PENDING')")
    List<String> findActiveParentTaskIds();
}
