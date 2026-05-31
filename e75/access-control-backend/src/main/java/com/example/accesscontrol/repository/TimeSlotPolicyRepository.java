package com.example.accesscontrol.repository;

import com.example.accesscontrol.model.TimeSlotPolicy;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.Optional;

@Repository
public interface TimeSlotPolicyRepository extends JpaRepository<TimeSlotPolicy, Long> {
    Optional<TimeSlotPolicy> findByName(String name);
}
