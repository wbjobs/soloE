package com.example.accesscontrol.dto;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.NotNull;
import lombok.Data;
import java.time.LocalDate;

@Data
public class HolidayRequest {
    @NotBlank(message = "节假日名称不能为空")
    private String name;

    @NotNull(message = "日期不能为空")
    private LocalDate date;

    private boolean blocked = true;

    private String description;
}
