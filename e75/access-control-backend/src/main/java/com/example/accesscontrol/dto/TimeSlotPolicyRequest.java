package com.example.accesscontrol.dto;

import javax.validation.constraints.NotBlank;
import lombok.Data;
import java.util.Set;

@Data
public class TimeSlotPolicyRequest {
    @NotBlank(message = "策略名称不能为空")
    private String name;

    private String description;

    private Set<com.example.accesscontrol.model.TimeSlot> timeSlots;

    private boolean holidayBlocked = true;
}
