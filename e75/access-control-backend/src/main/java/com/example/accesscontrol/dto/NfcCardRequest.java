package com.example.accesscontrol.dto;

import javax.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class NfcCardRequest {
    @NotBlank(message = "UID不能为空")
    private String uid;

    private Long personId;

    private Long policyId;

    private boolean active = true;
}
