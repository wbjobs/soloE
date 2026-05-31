package com.example.accesscontrol.dto;

import lombok.Data;
import javax.validation.constraints.NotBlank;

@Data
public class TokenCheckRequest {
    @NotBlank(message = "临时码不能为空")
    private String token;

    @NotBlank(message = "时间不能为空")
    private String datetime;
}
