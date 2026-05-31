package com.example.accesscontrol.controller;

import com.example.accesscontrol.model.AccessLog;
import com.example.accesscontrol.service.AccessLogService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/api/logs")
@RequiredArgsConstructor
public class AccessLogController {

    private final AccessLogService accessLogService;

    @GetMapping
    public ResponseEntity<List<AccessLog>> findAll() {
        return ResponseEntity.ok(accessLogService.findAll());
    }

    @GetMapping("/card/{cardUid}")
    public ResponseEntity<List<AccessLog>> findByCardUid(@PathVariable String cardUid) {
        return ResponseEntity.ok(accessLogService.findByCardUid(cardUid));
    }

    @GetMapping("/token/{token}")
    public ResponseEntity<List<AccessLog>> findByToken(@PathVariable String token) {
        return ResponseEntity.ok(accessLogService.findByToken(token));
    }
}
