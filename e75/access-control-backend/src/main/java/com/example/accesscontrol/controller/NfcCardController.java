package com.example.accesscontrol.controller;

import com.example.accesscontrol.dto.NfcCardRequest;
import com.example.accesscontrol.model.NfcCard;
import com.example.accesscontrol.service.NfcCardService;
import javax.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/api/cards")
@RequiredArgsConstructor
public class NfcCardController {

    private final NfcCardService nfcCardService;

    @GetMapping
    public ResponseEntity<List<NfcCard>> findAll() {
        return ResponseEntity.ok(nfcCardService.findAll());
    }

    @GetMapping("/{uid}")
    public ResponseEntity<NfcCard> findByUid(@PathVariable String uid) {
        return nfcCardService.findByUid(uid)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping
    public ResponseEntity<?> create(@Valid @RequestBody NfcCardRequest request) {
        try {
            NfcCard card = nfcCardService.create(request);
            return ResponseEntity.status(HttpStatus.CREATED).body(card);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(e.getMessage());
        }
    }

    @PutMapping("/{uid}")
    public ResponseEntity<NfcCard> update(@PathVariable String uid, @Valid @RequestBody NfcCardRequest request) {
        return nfcCardService.update(uid, request)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @DeleteMapping("/{uid}")
    public ResponseEntity<Void> delete(@PathVariable String uid) {
        if (nfcCardService.delete(uid)) {
            return ResponseEntity.noContent().build();
        }
        return ResponseEntity.notFound().build();
    }
}
