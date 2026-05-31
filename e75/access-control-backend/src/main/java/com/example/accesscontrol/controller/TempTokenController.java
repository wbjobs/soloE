package com.example.accesscontrol.controller;

import com.example.accesscontrol.dto.TempTokenRequest;
import com.example.accesscontrol.dto.TokenCheckRequest;
import com.example.accesscontrol.model.AccessCheckResult;
import com.example.accesscontrol.model.TempToken;
import com.example.accesscontrol.repository.TempTokenRepository;
import com.example.accesscontrol.service.TempTokenService;
import javax.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;

@RestController
@RequestMapping("/api/tokens")
@RequiredArgsConstructor
public class TempTokenController {

    private final TempTokenService tempTokenService;
    private final TempTokenRepository tempTokenRepository;
    private static final DateTimeFormatter FORMATTER = DateTimeFormatter.ISO_LOCAL_DATE_TIME;

    @GetMapping
    public ResponseEntity<List<TempToken>> findAll() {
        return ResponseEntity.ok(tempTokenRepository.findAll());
    }

    @GetMapping("/{token}")
    public ResponseEntity<TempToken> findByToken(@PathVariable String token) {
        return tempTokenRepository.findByToken(token)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping
    public ResponseEntity<?> create(@Valid @RequestBody TempTokenRequest request) {
        try {
            TempToken token = tempTokenService.createToken(request);
            return ResponseEntity.status(HttpStatus.CREATED).body(token);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(e.getMessage());
        }
    }

    @PostMapping("/check")
    public ResponseEntity<AccessCheckResult> checkToken(@Valid @RequestBody TokenCheckRequest request) {
        LocalDateTime checkTime;
        try {
            checkTime = LocalDateTime.parse(request.getDatetime(), FORMATTER);
        } catch (Exception e) {
            AccessCheckResult result = new AccessCheckResult();
            result.setUid(request.getToken());
            result.setAllowed(false);
            result.setMessage("时间格式错误，请使用 ISO-8601 格式 (如: 2026-05-17T09:30:00)");
            return ResponseEntity.badRequest().body(result);
        }

        AccessCheckResult result = tempTokenService.checkToken(request.getToken(), checkTime);
        return ResponseEntity.ok(result);
    }

    @GetMapping("/check")
    public ResponseEntity<AccessCheckResult> checkTokenGet(
            @RequestParam String token,
            @RequestParam String datetime) {
        LocalDateTime checkTime;
        try {
            checkTime = LocalDateTime.parse(datetime, FORMATTER);
        } catch (Exception e) {
            AccessCheckResult result = new AccessCheckResult();
            result.setUid(token);
            result.setAllowed(false);
            result.setMessage("时间格式错误，请使用 ISO-8601 格式 (如: 2026-05-17T09:30:00)");
            return ResponseEntity.badRequest().body(result);
        }

        AccessCheckResult result = tempTokenService.checkToken(token, checkTime);
        return ResponseEntity.ok(result);
    }

    @DeleteMapping("/{id}/revoke")
    public ResponseEntity<Void> revoke(@PathVariable Long id) {
        if (tempTokenService.revokeToken(id)) {
            return ResponseEntity.noContent().build();
        }
        return ResponseEntity.notFound().build();
    }
}
