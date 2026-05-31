package com.example.accesscontrol.controller;

import com.example.accesscontrol.dto.HolidayRequest;
import com.example.accesscontrol.model.Holiday;
import com.example.accesscontrol.service.HolidayService;
import javax.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.time.LocalDate;
import java.util.List;

@RestController
@RequestMapping("/api/holidays")
@RequiredArgsConstructor
public class HolidayController {

    private final HolidayService holidayService;

    @GetMapping
    public ResponseEntity<List<Holiday>> findAll() {
        return ResponseEntity.ok(holidayService.findAll());
    }

    @GetMapping("/date/{date}")
    public ResponseEntity<Holiday> findByDate(@PathVariable String date) {
        return holidayService.findByDate(LocalDate.parse(date))
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping
    public ResponseEntity<?> create(@Valid @RequestBody HolidayRequest request) {
        try {
            Holiday holiday = holidayService.create(request);
            return ResponseEntity.status(HttpStatus.CREATED).body(holiday);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(e.getMessage());
        }
    }

    @PutMapping("/{id}")
    public ResponseEntity<Holiday> update(@PathVariable Long id, @Valid @RequestBody HolidayRequest request) {
        return holidayService.update(id, request)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        if (holidayService.delete(id)) {
            return ResponseEntity.noContent().build();
        }
        return ResponseEntity.notFound().build();
    }
}
