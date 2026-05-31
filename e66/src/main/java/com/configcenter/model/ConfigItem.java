package com.configcenter.model;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.annotation.JsonIgnore;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ConfigItem {

    private String key;
    private String value;
    private String env;
    private String appName;
    private String description;
    private String version;
    private String createdBy;
    private String updatedBy;
    private Boolean encrypted;

    @JsonIgnore
    private transient String decryptedValue;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private LocalDateTime createdAt;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private LocalDateTime updatedAt;

    public boolean isEncrypted() {
        return Boolean.TRUE.equals(encrypted);
    }
}
