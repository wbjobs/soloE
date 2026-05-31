package com.scheduler.repository;

import com.scheduler.entity.DAGEdge;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface DAGEdgeRepository extends JpaRepository<DAGEdge, Long> {

    List<DAGEdge> findByDagId(String dagId);

    @Query("SELECT e.toTask FROM DAGEdge e WHERE e.dagId = :dagId AND e.fromTask = :taskName")
    List<String> findSuccessorTasks(@Param("dagId") String dagId, @Param("taskName") String taskName);

    @Query("SELECT e.fromTask FROM DAGEdge e WHERE e.dagId = :dagId AND e.toTask = :taskName")
    List<String> findPredecessorTasks(@Param("dagId") String dagId, @Param("taskName") String taskName);
}
