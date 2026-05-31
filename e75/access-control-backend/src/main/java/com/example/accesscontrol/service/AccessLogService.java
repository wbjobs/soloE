package com.example.accesscontrol.service;

import com.example.accesscontrol.model.AccessLog;
import com.example.accesscontrol.repository.AccessLogRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import java.util.List;

@Service
@RequiredArgsConstructor
public class AccessLogService {

    private final AccessLogRepository accessLogRepository;

    public List<AccessLog> findAll() {
        return accessLogRepository.findTop100ByOrderByAccessTimeDesc();
    }

    public List<AccessLog> findByCardUid(String cardUid) {
        return accessLogRepository.findByCardUidOrderByAccessTimeDesc(cardUid);
    }

    public List<AccessLog> findByToken(String token) {
        return accessLogRepository.findByTokenOrderByAccessTimeDesc(token);
    }
}
