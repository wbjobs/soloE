package com.example.accesscontrol.service;

import com.example.accesscontrol.dto.TempTokenRequest;
import com.example.accesscontrol.model.*;
import com.example.accesscontrol.repository.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.Optional;
import java.util.Random;

@Slf4j
@Service
@RequiredArgsConstructor
public class TempTokenService {

    private final TempTokenRepository tempTokenRepository;
    private final TimeSlotPolicyRepository policyRepository;
    private final HolidayRepository holidayRepository;
    private final AccessLogRepository accessLogRepository;
    private final Random random = new Random();

    public TempToken createToken(TempTokenRequest request) {
        TimeSlotPolicy policy = policyRepository.findById(request.getPolicyId())
                .orElseThrow(() -> new IllegalArgumentException("门禁策略不存在"));

        String token = generateUniqueToken();
        int validMinutes = request.getValidMinutes() != null ? request.getValidMinutes() : 120;
        int maxUses = request.getMaxUses() != null ? request.getMaxUses() : 1;

        TempToken tempToken = new TempToken();
        tempToken.setToken(token);
        tempToken.setPolicy(policy);
        tempToken.setExpiresAt(LocalDateTime.now().plusMinutes(validMinutes));
        tempToken.setMaxUses(maxUses);
        tempToken.setVisitorName(request.getVisitorName());
        tempToken.setVisitorPhone(request.getVisitorPhone());
        tempToken.setActive(true);

        TempToken saved = tempTokenRepository.save(tempToken);
        log.info("生成临时访客码: {}，策略: {}，有效期: {}分钟，最大使用次数: {}",
                token, policy.getName(), validMinutes, maxUses);
        return saved;
    }

    public AccessCheckResult checkToken(String token, LocalDateTime checkTime) {
        log.info("临时码检查: token={}, 时间={}", token, checkTime);

        AccessCheckResult result = new AccessCheckResult();
        result.setUid(token);
        result.setCheckTime(checkTime);

        Optional<TempToken> tokenOpt = tempTokenRepository.findByToken(token);
        if (!tokenOpt.isPresent()) {
            result.setAllowed(false);
            result.setMessage("临时码不存在");
            logAccess(token, null, null, false, "临时码不存在", checkTime);
            return result;
        }

        TempToken tempToken = tokenOpt.get();
        result.setPersonName(tempToken.getVisitorName() != null ? tempToken.getVisitorName() : "访客");
        result.setPolicyName(tempToken.getPolicy() != null ? tempToken.getPolicy().getName() : "无策略");

        if (!tempToken.isActive()) {
            result.setAllowed(false);
            result.setMessage("临时码已被禁用");
            logAccess(token, tempToken.getVisitorName(), tempToken.getPolicy().getName(),
                    false, "临时码已被禁用", checkTime);
            return result;
        }

        if (tempToken.getUsedCount() >= tempToken.getMaxUses()) {
            result.setAllowed(false);
            result.setMessage("临时码已超过使用次数");
            logAccess(token, tempToken.getVisitorName(), tempToken.getPolicy().getName(),
                    false, "临时码已超过使用次数", checkTime);
            return result;
        }

        if (checkTime.isAfter(tempToken.getExpiresAt())) {
            result.setAllowed(false);
            result.setMessage("临时码已过期");
            logAccess(token, tempToken.getVisitorName(), tempToken.getPolicy().getName(),
                    false, "临时码已过期", checkTime);
            return result;
        }

        TimeSlotPolicy policy = tempToken.getPolicy();

        Optional<Holiday> holidayOpt = holidayRepository.findByDate(checkTime.toLocalDate());
        if (holidayOpt.isPresent() && holidayOpt.get().isBlocked()) {
            result.setAllowed(false);
            result.setMessage("节假日禁止通行: " + holidayOpt.get().getName());
            logAccess(token, tempToken.getVisitorName(), policy.getName(),
                    false, "节假日禁止通行: " + holidayOpt.get().getName(), checkTime);
            return result;
        }

        java.time.DayOfWeek dayOfWeek = checkTime.getDayOfWeek();
        LocalTime currentTime = checkTime.toLocalTime();

        boolean timeAllowed = policy.getTimeSlots().stream()
                .anyMatch(slot -> slot.isWithin(dayOfWeek, currentTime));

        if (timeAllowed) {
            tempToken.setUsedCount(tempToken.getUsedCount() + 1);
            tempTokenRepository.save(tempToken);
            result.setAllowed(true);
            result.setMessage("允许通行");
            logAccess(token, tempToken.getVisitorName(), policy.getName(),
                    true, "允许通行", checkTime);
        } else {
            result.setAllowed(false);
            result.setMessage("当前时间段不允许通行");
            logAccess(token, tempToken.getVisitorName(), policy.getName(),
                    false, "当前时间段不允许通行", checkTime);
        }

        return result;
    }

    private String generateUniqueToken() {
        String token;
        do {
            token = String.format("%06d", random.nextInt(1000000));
        } while (tempTokenRepository.existsByToken(token));
        return token;
    }

    private void logAccess(String token, String personName, String policyName,
                           boolean allowed, String message, LocalDateTime accessTime) {
        AccessLog log = new AccessLog();
        log.setToken(token);
        log.setPersonName(personName);
        log.setPolicyName(policyName);
        log.setAllowed(allowed);
        log.setMessage(message);
        log.setAccessTime(accessTime);
        accessLogRepository.save(log);
    }

    public boolean revokeToken(Long id) {
        return tempTokenRepository.findById(id).map(token -> {
            token.setActive(false);
            tempTokenRepository.save(token);
            log.info("吊销临时码: {}", token.getToken());
            return true;
        }).orElse(false);
    }
}
