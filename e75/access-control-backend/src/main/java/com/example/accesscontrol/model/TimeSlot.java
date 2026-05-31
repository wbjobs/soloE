package com.example.accesscontrol.model;

import javax.persistence.Embeddable;
import javax.persistence.EnumType;
import javax.persistence.Enumerated;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;
import java.time.DayOfWeek;
import java.time.LocalTime;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Embeddable
public class TimeSlot {
    @Enumerated(EnumType.STRING)
    private DayOfWeek dayOfWeek;

    private LocalTime startTime;

    private LocalTime endTime;

    public boolean isWithin(DayOfWeek day, LocalTime time) {
        return this.dayOfWeek == day &&
                !time.isBefore(startTime) &&
                !time.isAfter(endTime);
    }
}
