package com.scheduler.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class DAGRequest {

    @NotBlank
    private String name;

    private String description;
}
