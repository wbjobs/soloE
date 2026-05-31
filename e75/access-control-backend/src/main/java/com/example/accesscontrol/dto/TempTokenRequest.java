package com.example.accesscontrol.dto;

import lombok.Data;
import javax.validation.constraints.NotNull;

@Data
public class TempTokenRequest {
    @NotNull(message = "门禁策略ID不能为空")
    private Long policyId;

    private Integer validMinutes = 120;

    private Integer maxUses = 1;

    private String visitorName;

    private String visitorPhone;
}
