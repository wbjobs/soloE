package com.example.accesscontrol.repository;

import com.example.accesscontrol.model.NfcCard;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.Optional;

@Repository
public interface NfcCardRepository extends JpaRepository<NfcCard, Long> {
    Optional<NfcCard> findByUid(String uid);
    boolean existsByUid(String uid);
}
