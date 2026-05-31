package com.scheduler.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data
public class TaskRequest {

    @NotBlank
    private String taskName;

    @NotBlank
    private String type;

    @NotNull
    private String priority;

    private String payload;

    private Integer maxRetries = 5;

    private Long timeoutMs = 300000L;
}
