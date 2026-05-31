package com.example.accesscontrol.service;

import com.example.accesscontrol.dto.TimeSlotPolicyRequest;
import com.example.accesscontrol.model.TimeSlotPolicy;
import com.example.accesscontrol.repository.TimeSlotPolicyRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import java.util.List;
import java.util.Optional;

@Service
@RequiredArgsConstructor
public class TimeSlotPolicyService {

    private final TimeSlotPolicyRepository policyRepository;

    public List<TimeSlotPolicy> findAll() {
        return policyRepository.findAll();
    }

    public Optional<TimeSlotPolicy> findById(Long id) {
        return policyRepository.findById(id);
    }

    public TimeSlotPolicy create(TimeSlotPolicyRequest request) {
        if (policyRepository.findByName(request.getName()).isPresent()) {
            throw new IllegalArgumentException("策略名称已存在");
        }
        TimeSlotPolicy policy = new TimeSlotPolicy();
        policy.setName(request.getName());
        policy.setDescription(request.getDescription());
        policy.setTimeSlots(request.getTimeSlots());
        policy.setHolidayBlocked(request.isHolidayBlocked());
        return policyRepository.save(policy);
    }

    public Optional<TimeSlotPolicy> update(Long id, TimeSlotPolicyRequest request) {
        return policyRepository.findById(id).map(policy -> {
            policy.setName(request.getName());
            policy.setDescription(request.getDescription());
            policy.setTimeSlots(request.getTimeSlots());
            policy.setHolidayBlocked(request.isHolidayBlocked());
            return policyRepository.save(policy);
        });
    }

    public boolean delete(Long id) {
        if (policyRepository.existsById(id)) {
            policyRepository.deleteById(id);
            return true;
        }
        return false;
    }
}
