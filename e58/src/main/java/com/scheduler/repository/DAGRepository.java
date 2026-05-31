package com.scheduler.repository;

import com.scheduler.entity.DAG;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface DAGRepository extends JpaRepository<DAG, String> {

    Optional<DAG> findByName(String name);
}
