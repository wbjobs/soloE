package com.example.accesscontrol.service;

import com.example.accesscontrol.dto.NfcCardRequest;
import com.example.accesscontrol.model.NfcCard;
import com.example.accesscontrol.repository.NfcCardRepository;
import com.example.accesscontrol.repository.PersonRepository;
import com.example.accesscontrol.repository.TimeSlotPolicyRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import java.util.List;
import java.util.Optional;

@Service
@RequiredArgsConstructor
public class NfcCardService {

    private final NfcCardRepository nfcCardRepository;
    private final PersonRepository personRepository;
    private final TimeSlotPolicyRepository policyRepository;

    public List<NfcCard> findAll() {
        return nfcCardRepository.findAll();
    }

    public Optional<NfcCard> findByUid(String uid) {
        return nfcCardRepository.findByUid(uid);
    }

    public NfcCard create(NfcCardRequest request) {
        if (nfcCardRepository.existsByUid(request.getUid())) {
            throw new IllegalArgumentException("UID已存在");
        }
        NfcCard card = new NfcCard();
        card.setUid(request.getUid());
        card.setActive(request.isActive());

        if (request.getPersonId() != null) {
            personRepository.findById(request.getPersonId()).ifPresent(card::setPerson);
        }
        if (request.getPolicyId() != null) {
            policyRepository.findById(request.getPolicyId()).ifPresent(card::setPolicy);
        }

        return nfcCardRepository.save(card);
    }

    public Optional<NfcCard> update(String uid, NfcCardRequest request) {
        return nfcCardRepository.findByUid(uid).map(card -> {
            card.setActive(request.isActive());
            if (request.getPersonId() != null) {
                personRepository.findById(request.getPersonId()).ifPresent(card::setPerson);
            }
            if (request.getPolicyId() != null) {
                policyRepository.findById(request.getPolicyId()).ifPresent(card::setPolicy);
            }
            return nfcCardRepository.save(card);
        });
    }

    public boolean delete(String uid) {
        return nfcCardRepository.findByUid(uid)
                .map(card -> {
                    nfcCardRepository.delete(card);
                    return true;
                })
                .orElse(false);
    }
}
