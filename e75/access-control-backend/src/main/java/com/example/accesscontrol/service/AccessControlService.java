package com.example.accesscontrol.service;

import com.example.accesscontrol.model.*;
import com.example.accesscontrol.repository.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import java.time.DayOfWeek;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.Optional;

@Slf4j
@Service
@RequiredArgsConstructor
public class AccessControlService {

    private final NfcCardRepository nfcCardRepository;
    private final HolidayRepository holidayRepository;
    private final AccessLogRepository accessLogRepository;

    public AccessCheckResult checkAccess(String uid, LocalDateTime checkTime) {
        log.info("门禁检查: UID={}, 时间={}", uid, checkTime);

        AccessCheckResult result = new AccessCheckResult();
        result.setUid(uid);
        result.setCheckTime(checkTime);

        Optional<NfcCard> cardOpt = nfcCardRepository.findByUid(uid);
        if (!cardOpt.isPresent()) {
            result.setAllowed(false);
            result.setMessage("NFC卡不存在");
            logAccess(uid, null, null, false, "NFC卡不存在", checkTime);
            return result;
        }

        NfcCard card = cardOpt.get();
        result.setPersonName(card.getPerson() != null ? card.getPerson().getName() : "未绑定");
        result.setPolicyName(card.getPolicy() != null ? card.getPolicy().getName() : "无策略");

        if (!card.isActive()) {
            result.setAllowed(false);
            result.setMessage("NFC卡已被停用");
            logAccess(uid, result.getPersonName(), result.getPolicyName(),
                    false, "NFC卡已被停用", checkTime);
            return result;
        }

        if (card.getPerson() == null) {
            result.setAllowed(false);
            result.setMessage("NFC卡未绑定人员");
            logAccess(uid, result.getPersonName(), result.getPolicyName(),
                    false, "NFC卡未绑定人员", checkTime);
            return result;
        }

        if (card.getPolicy() == null) {
            result.setAllowed(false);
            result.setMessage("未配置门禁策略");
            logAccess(uid, result.getPersonName(), result.getPolicyName(),
                    false, "未配置门禁策略", checkTime);
            return result;
        }

        TimeSlotPolicy policy = card.getPolicy();

        Optional<Holiday> holidayOpt = holidayRepository.findByDate(checkTime.toLocalDate());
        if (holidayOpt.isPresent() && holidayOpt.get().isBlocked()) {
            result.setAllowed(false);
            result.setMessage("节假日禁止通行: " + holidayOpt.get().getName());
            logAccess(uid, result.getPersonName(), result.getPolicyName(),
                    false, "节假日禁止通行: " + holidayOpt.get().getName(), checkTime);
            return result;
        }

        DayOfWeek dayOfWeek = checkTime.getDayOfWeek();
        LocalTime currentTime = checkTime.toLocalTime();

        boolean timeAllowed = policy.getTimeSlots().stream()
                .anyMatch(slot -> slot.isWithin(dayOfWeek, currentTime));

        if (timeAllowed) {
            result.setAllowed(true);
            result.setMessage("允许通行");
            logAccess(uid, result.getPersonName(), result.getPolicyName(),
                    true, "允许通行", checkTime);
        } else {
            result.setAllowed(false);
            result.setMessage("当前时间段不允许通行");
            logAccess(uid, result.getPersonName(), result.getPolicyName(),
                    false, "当前时间段不允许通行", checkTime);
        }

        return result;
    }

    private void logAccess(String cardUid, String personName, String policyName,
                         boolean allowed, String message, LocalDateTime accessTime) {
        AccessLog log = new AccessLog();
        log.setCardUid(cardUid);
        log.setPersonName(personName);
        log.setPolicyName(policyName);
        log.setAllowed(allowed);
        log.setMessage(message);
        log.setAccessTime(accessTime);
        accessLogRepository.save(log);
    }
}
