package com.scheduler.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class DAGEdgeRequest {

    @NotBlank
    private String fromTask;

    @NotBlank
    private String toTask;
}
