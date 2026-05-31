package com.example.accesscontrol.controller;

import com.example.accesscontrol.dto.TimeSlotPolicyRequest;
import com.example.accesscontrol.model.TimeSlotPolicy;
import com.example.accesscontrol.service.TimeSlotPolicyService;
import javax.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/api/policies")
@RequiredArgsConstructor
public class TimeSlotPolicyController {

    private final TimeSlotPolicyService policyService;

    @GetMapping
    public ResponseEntity<List<TimeSlotPolicy>> findAll() {
        return ResponseEntity.ok(policyService.findAll());
    }

    @GetMapping("/{id}")
    public ResponseEntity<TimeSlotPolicy> findById(@PathVariable Long id) {
        return policyService.findById(id)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping
    public ResponseEntity<?> create(@Valid @RequestBody TimeSlotPolicyRequest request) {
        try {
            TimeSlotPolicy policy = policyService.create(request);
            return ResponseEntity.status(HttpStatus.CREATED).body(policy);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(e.getMessage());
        }
    }

    @PutMapping("/{id}")
    public ResponseEntity<TimeSlotPolicy> update(@PathVariable Long id, @Valid @RequestBody TimeSlotPolicyRequest request) {
        return policyService.update(id, request)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        if (policyService.delete(id)) {
            return ResponseEntity.noContent().build();
        }
        return ResponseEntity.notFound().build();
    }
}
