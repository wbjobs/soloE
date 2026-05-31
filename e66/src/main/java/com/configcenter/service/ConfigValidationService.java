package com.configcenter.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.yaml.snakeyaml.Yaml;
import org.yaml.snakeyaml.error.YAMLException;
import org.springframework.stereotype.Service;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.Properties;

@Slf4j
@Service
@RequiredArgsConstructor
public class ConfigValidationService {

    private final ObjectMapper objectMapper;
    private final Yaml yaml = new Yaml();

    public enum Format {
        JSON, YAML, PROPERTIES
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ValidationResult {
        private boolean valid;
        private String format;
        private String errorMessage;
        private Integer lineNumber;
        private Integer columnNumber;
        private Map<String, Object> parsedData;
    }

    public ValidationResult validate(String content, String format) {
        Format fmt = parseFormat(format);
        return validate(content, fmt);
    }

    public ValidationResult validate(String content, Format format) {
        try {
            switch (format) {
                case JSON:
                    return validateJson(content);
                case YAML:
                    return validateYaml(content);
                case PROPERTIES:
                    return validateProperties(content);
                default:
                    return validateAuto(content);
            }
        } catch (Exception e) {
            log.error("Validation error", e);
            return ValidationResult.builder()
                    .valid(false)
                    .format(format.name())
                    .errorMessage("Unexpected error: " + e.getMessage())
                    .build();
        }
    }

    private ValidationResult validateJson(String content) {
        try {
            JsonNode node = objectMapper.readTree(content);
            return ValidationResult.builder()
                    .valid(true)
                    .format("JSON")
                    .parsedData(objectMapper.convertValue(node, Map.class))
                    .build();
        } catch (com.fasterxml.jackson.core.JsonParseException e) {
            String message = e.getOriginalMessage();
            int line = e.getLocation().getLineNr();
            int column = e.getLocation().getColumnNr();
            return ValidationResult.builder()
                    .valid(false)
                    .format("JSON")
                    .errorMessage("JSON parse error: " + message)
                    .lineNumber(line)
                    .columnNumber(column)
                    .build();
        } catch (Exception e) {
            return ValidationResult.builder()
                    .valid(false)
                    .format("JSON")
                    .errorMessage("JSON validation error: " + e.getMessage())
                    .build();
        }
    }

    private ValidationResult validateYaml(String content) {
        try {
            Object parsed = yaml.load(content);
            Map<String, Object> data = new HashMap<>();
            if (parsed instanceof Map) {
                data.putAll((Map) parsed);
            } else if (parsed != null) {
                data.put("value", parsed);
            }
            return ValidationResult.builder()
                    .valid(true)
                    .format("YAML")
                    .parsedData(data)
                    .build();
        } catch (YAMLException e) {
            String message = e.getMessage();
            Integer line = extractLineNumber(message);
            return ValidationResult.builder()
                    .valid(false)
                    .format("YAML")
                    .errorMessage("YAML parse error: " + message)
                    .lineNumber(line)
                    .build();
        } catch (Exception e) {
            return ValidationResult.builder()
                    .valid(false)
                    .format("YAML")
                    .errorMessage("YAML validation error: " + e.getMessage())
                    .build();
        }
    }

    private ValidationResult validateProperties(String content) {
        try {
            Properties props = new Properties();
            try (InputStream is = new ByteArrayInputStream(content.getBytes())) {
                props.load(is);
            }
            Map<String, Object> data = new HashMap<>();
            props.forEach((k, v) -> data.put(String.valueOf(k), v));
            return ValidationResult.builder()
                    .valid(true)
                    .format("PROPERTIES")
                    .parsedData(data)
                    .build();
        } catch (IOException e) {
            String message = e.getMessage();
            return ValidationResult.builder()
                    .valid(false)
                    .format("PROPERTIES")
                    .errorMessage("Properties parse error: " + message)
                    .build();
        }
    }

    private ValidationResult validateAuto(String content) {
        ValidationResult result = validateJson(content);
        if (result.isValid()) {
            return result;
        }

        result = validateYaml(content);
        if (result.isValid()) {
            return result;
        }

        result = validateProperties(content);
        if (result.isValid()) {
            return result;
        }

        return ValidationResult.builder()
                .valid(false)
                .format("UNKNOWN")
                .errorMessage("Content is not valid JSON, YAML, or Properties format")
                .build();
    }

    public Format detectFormat(String content) {
        if (content == null || content.trim().isEmpty()) {
            return Format.JSON;
        }

        String trimmed = content.trim();
        if (trimmed.startsWith("{")) {
            return Format.JSON;
        } else if (trimmed.startsWith("#") || trimmed.contains(":") && !trimmed.startsWith("{")) {
            return Format.YAML;
        } else if (trimmed.contains("=") && !trimmed.startsWith("{")) {
            return Format.PROPERTIES;
        }

        return Format.JSON;
    }

    private Format parseFormat(String format) {
        if (format == null || format.isEmpty()) {
            return Format.JSON;
        }
        try {
            return Format.valueOf(format.toUpperCase());
        } catch (IllegalArgumentException e) {
            return Format.JSON;
        }
    }

    private Integer extractLineNumber(String message) {
        try {
            int idx = message.indexOf("line ");
            if (idx > 0) {
                String numStr = message.substring(idx + 5);
                int endIdx = numStr.indexOf(',');
                if (endIdx > 0) {
                    numStr = numStr.substring(0, endIdx);
                }
                return Integer.parseInt(numStr.trim());
            }
        } catch (Exception e) {
            // ignore
        }
        return null;
    }

    public Map<String, Object> parse(String content, Format format) throws Exception {
        switch (format) {
            case JSON:
                JsonNode node = objectMapper.readTree(content);
                return objectMapper.convertValue(node, Map.class);
            case YAML:
                Object parsed = yaml.load(content);
                if (parsed instanceof Map) {
                    return (Map<String, Object>) parsed;
                }
                Map<String, Object> result = new HashMap<>();
                result.put("value", parsed);
                return result;
            case PROPERTIES:
                Properties props = new Properties();
                try (InputStream is = new ByteArrayInputStream(content.getBytes())) {
                    props.load(is);
                }
                Map<String, Object> propsMap = new HashMap<>();
                props.forEach((k, v) -> propsMap.put(String.valueOf(k), v));
                return propsMap;
            default:
                throw new IllegalArgumentException("Unknown format: " + format);
        }
    }
}
