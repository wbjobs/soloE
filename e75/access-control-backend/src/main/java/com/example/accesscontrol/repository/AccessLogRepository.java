package com.example.accesscontrol.repository;

import com.example.accesscontrol.model.AccessLog;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface AccessLogRepository extends JpaRepository<AccessLog, Long> {
    List<AccessLog> findByCardUidOrderByAccessTimeDesc(String cardUid);
    List<AccessLog> findByTokenOrderByAccessTimeDesc(String token);
    List<AccessLog> findTop100ByOrderByAccessTimeDesc();
}
