package com.example.accesscontrol.cli;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class AccessCheckResponse {
    private boolean allowed;
    private String message;
    private String uid;
    private LocalDateTime checkTime;
    private String personName;
    private String policyName;
}
