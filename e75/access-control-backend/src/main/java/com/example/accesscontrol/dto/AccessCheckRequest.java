package com.example.accesscontrol.dto;

import javax.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class AccessCheckRequest {
    @NotBlank(message = "UID不能为空")
    private String uid;

    @NotBlank(message = "时间不能为空")
    private String datetime;
}
