package com.example.accesscontrol.model;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class AccessCheckResult {
    private boolean allowed;
    private String message;
    private String uid;
    private LocalDateTime checkTime;
    private String personName;
    private String policyName;
}
