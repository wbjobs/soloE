package com.example.accesscontrol.repository;

import com.example.accesscontrol.model.TempToken;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.Optional;

@Repository
public interface TempTokenRepository extends JpaRepository<TempToken, Long> {
    Optional<TempToken> findByToken(String token);
    boolean existsByToken(String token);
}
