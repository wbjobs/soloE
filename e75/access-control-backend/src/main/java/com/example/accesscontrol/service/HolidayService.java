package com.example.accesscontrol.service;

import com.example.accesscontrol.dto.HolidayRequest;
import com.example.accesscontrol.model.Holiday;
import com.example.accesscontrol.repository.HolidayRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

@Service
@RequiredArgsConstructor
public class HolidayService {

    private final HolidayRepository holidayRepository;

    public List<Holiday> findAll() {
        return holidayRepository.findAll();
    }

    public Optional<Holiday> findByDate(LocalDate date) {
        return holidayRepository.findByDate(date);
    }

    public Holiday create(HolidayRequest request) {
        if (holidayRepository.existsByDate(request.getDate())) {
            throw new IllegalArgumentException("该日期已配置节假日");
        }
        Holiday holiday = new Holiday();
        holiday.setName(request.getName());
        holiday.setDate(request.getDate());
        holiday.setBlocked(request.isBlocked());
        holiday.setDescription(request.getDescription());
        return holidayRepository.save(holiday);
    }

    public Optional<Holiday> update(Long id, HolidayRequest request) {
        return holidayRepository.findById(id).map(holiday -> {
            holiday.setName(request.getName());
            holiday.setDate(request.getDate());
            holiday.setBlocked(request.isBlocked());
            holiday.setDescription(request.getDescription());
            return holidayRepository.save(holiday);
        });
    }

    public boolean delete(Long id) {
        if (holidayRepository.existsById(id)) {
            holidayRepository.deleteById(id);
            return true;
        }
        return false;
    }
}
