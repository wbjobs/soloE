package com.example.accesscontrol.dto;

import javax.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class PersonRequest {
    @NotBlank(message = "姓名不能为空")
    private String name;

    private String department;

    private String phone;

    @NotBlank(message = "员工号不能为空")
    private String employeeId;
}
