package com.example.accesscontrol.controller;

import com.example.accesscontrol.dto.AccessCheckRequest;
import com.example.accesscontrol.model.AccessCheckResult;
import com.example.accesscontrol.service.AccessControlService;
import javax.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

@RestController
@RequestMapping("/api/access")
@RequiredArgsConstructor
public class AccessController {

    private final AccessControlService accessControlService;
    private static final DateTimeFormatter FORMATTER = DateTimeFormatter.ISO_LOCAL_DATE_TIME;

    @PostMapping("/check")
    public ResponseEntity<AccessCheckResult> checkAccess(@Valid @RequestBody AccessCheckRequest request) {
        LocalDateTime checkTime;
        try {
            checkTime = LocalDateTime.parse(request.getDatetime(), FORMATTER);
        } catch (Exception e) {
            AccessCheckResult result = new AccessCheckResult();
            result.setUid(request.getUid());
            result.setAllowed(false);
            result.setMessage("时间格式错误，请使用 ISO-8601 格式 (如: 2026-05-17T09:30:00)");
            return ResponseEntity.badRequest().body(result);
        }

        AccessCheckResult result = accessControlService.checkAccess(request.getUid(), checkTime);
        return ResponseEntity.ok(result);
    }

    @GetMapping("/check")
    public ResponseEntity<AccessCheckResult> checkAccessGet(
            @RequestParam String uid,
            @RequestParam String datetime) {
        LocalDateTime checkTime;
        try {
            checkTime = LocalDateTime.parse(datetime, FORMATTER);
        } catch (Exception e) {
            AccessCheckResult result = new AccessCheckResult();
            result.setUid(uid);
            result.setAllowed(false);
            result.setMessage("时间格式错误，请使用 ISO-8601 格式 (如: 2026-05-17T09:30:00)");
            return ResponseEntity.badRequest().body(result);
        }

        AccessCheckResult result = accessControlService.checkAccess(uid, checkTime);
        return ResponseEntity.ok(result);
    }
}
