package com.configcenter.service;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.File;
import java.io.IOException;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Slf4j
@Service
@RequiredArgsConstructor
public class ConfigTestService {

    @Value("${config.test.script-dir:./scripts}")
    private String scriptDir;

    @Value("${config.test.timeout:30000}")
    private long testTimeout;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class TestResult {
        private String testId;
        private String configKey;
        private String env;
        private String appName;
        private String testName;
        private boolean passed;
        private String output;
        private String error;
        private long durationMs;
        private LocalDateTime timestamp;
        private String testType;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class TestCase {
        private String name;
        private String type;
        private String script;
        private String description;
    }

    public TestResult runTests(String env, String appName, String key, String value) {
        return runTests(env, appName, key, value, null);
    }

    public TestResult runTests(String env, String appName, String key, String value, List<TestCase> customTests) {
        String testId = UUID.randomUUID().toString();
        long startTime = System.currentTimeMillis();

        try {
            List<TestCase> tests = new ArrayList<>();

            if (customTests != null) {
                tests.addAll(customTests);
            }

            tests.addAll(getDefaultTests(key, value));

            StringBuilder output = new StringBuilder();
            StringBuilder errors = new StringBuilder();
            boolean allPassed = true;

            for (TestCase test : tests) {
                log.info("Running test: {}", test.getName());
                output.append("=== ").append(test.getName()).append(" ===\n");

                boolean passed = false;
                String testOutput = "";

                try {
                    passed = executeTest(test, key, value, env, appName);
                    testOutput = "PASSED";
                } catch (Exception e) {
                    testOutput = "FAILED: " + e.getMessage();
                    errors.append(test.getName()).append(": ").append(e.getMessage()).append("\n");
                    allPassed = false;
                }

                output.append(testOutput).append("\n\n");
            }

            long duration = System.currentTimeMillis() - startTime;

            return TestResult.builder()
                    .testId(testId)
                    .configKey(key)
                    .env(env)
                    .appName(appName)
                    .passed(allPassed)
                    .output(output.toString())
                    .error(errors.length() > 0 ? errors.toString() : null)
                    .durationMs(duration)
                    .timestamp(LocalDateTime.now())
                    .testType(customTests != null ? "CUSTOM" : "DEFAULT")
                    .build();

        } catch (Exception e) {
            log.error("Run tests failed", e);
            return TestResult.builder()
                    .testId(testId)
                    .configKey(key)
                    .env(env)
                    .appName(appName)
                    .passed(false)
                    .error("Test execution failed: " + e.getMessage())
                    .durationMs(System.currentTimeMillis() - startTime)
                    .timestamp(LocalDateTime.now())
                    .testType("ERROR")
                    .build();
        }
    }

    private List<TestCase> getDefaultTests(String key, String value) {
        List<TestCase> tests = new ArrayList<>();

        tests.add(TestCase.builder()
                .name("NotBlank")
                .type("VALIDATION")
                .description("Check config value is not blank")
                .build());

        tests.add(TestCase.builder()
                .name("BasicFormat")
                .type("VALIDATION")
                .description("Check basic format validity")
                .build());

        tests.add(TestCase.builder()
                .name("PlaceholderCheck")
                .type("VALIDATION")
                .description("Check for unresolved placeholders")
                .build());

        return tests;
    }

    private boolean executeTest(TestCase test, String key, String value, String env, String appName) {
        switch (test.getName()) {
            case "NotBlank":
                return validateNotBlank(value);
            case "BasicFormat":
                return validateBasicFormat(value);
            case "PlaceholderCheck":
                return validateNoPlaceholders(value);
            default:
                return executeCustomTest(test, key, value, env, appName);
        }
    }

    private boolean validateNotBlank(String value) {
        return value != null && !value.trim().isEmpty();
    }

    private boolean validateBasicFormat(String value) {
        if (value == null) {
            return true;
        }
        String trimmed = value.trim();
        if (trimmed.isEmpty()) {
            return true;
        }
        if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
            try {
                new com.fasterxml.jackson.databind.ObjectMapper().readTree(value);
                return true;
            } catch (Exception e) {
                throw new RuntimeException("Invalid JSON format");
            }
        }
        if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
            return true;
        }
        if (trimmed.matches("^[a-zA-Z0-9._-]+$")) {
            return true;
        }
        return true;
    }

    private boolean validateNoPlaceholders(String value) {
        if (value == null) {
            return true;
        }
        if (value.contains("${") || value.contains("{{") || value.contains("}}") || value.contains("}")) {
            if (value.contains("${") && value.contains("}")) {
                int start = value.indexOf("${");
                int end = value.indexOf("}", start);
                if (start < end) {
                    String placeholder = value.substring(start + 2, end);
                    if (!placeholder.isEmpty() && !placeholder.contains(":")) {
                        throw new RuntimeException("Unresolved placeholder found: " + placeholder);
                    }
                }
            }
        }
        return true;
    }

    private boolean executeCustomTest(TestCase test, String key, String value, String env, String appName) {
        if (test.getScript() != null && !test.getScript().isEmpty()) {
            return executeScriptTest(test.getScript(), key, value, env, appName);
        }
        return true;
    }

    private boolean executeScriptTest(String script, String key, String value, String env, String appName) {
        try {
            String scriptPath = scriptDir + File.separator + script;
            File scriptFile = new File(scriptPath);

            if (!scriptFile.exists()) {
                throw new RuntimeException("Script not found: " + scriptPath);
            }

            ProcessBuilder pb = new ProcessBuilder();
            pb.directory(new File(scriptDir));

            if (script.endsWith(".sh")) {
                pb.command("bash", script, key, value, env, appName);
            } else if (script.endsWith(".py")) {
                pb.command("python", script, key, value, env, appName);
            } else {
                throw new RuntimeException("Unsupported script type: " + script);
            }

            Process process = pb.start();
            boolean completed = process.waitFor(testTimeout, java.util.concurrent.TimeUnit.MILLISECONDS);

            if (!completed) {
                process.destroyForcibly();
                throw new RuntimeException("Test script timed out");
            }

            int exitCode = process.exitValue();
            if (exitCode != 0) {
                throw new RuntimeException("Script failed with exit code: " + exitCode);
            }

            return true;
        } catch (IOException | InterruptedException e) {
            throw new RuntimeException("Script execution failed: " + e.getMessage());
        }
    }

    public List<TestCase> getAvailableTests() {
        List<TestCase> tests = new ArrayList<>();

        tests.add(TestCase.builder()
                .name("NotBlank")
                .type("VALIDATION")
                .description("Ensure config value is not blank")
                .build());

        tests.add(TestCase.builder()
                .name("BasicFormat")
                .type("VALIDATION")
                .description("Validate basic format (JSON, string, etc.)")
                .build());

        tests.add(TestCase.builder()
                .name("PlaceholderCheck")
                .type("VALIDATION")
                .description("Check for unresolved placeholders")
                .build());

        File dir = new File(scriptDir);
        if (dir.exists() && dir.isDirectory()) {
            File[] files = dir.listFiles((d, name) -> name.endsWith(".sh") || name.endsWith(".py"));
            if (files != null) {
                for (File file : files) {
                    tests.add(TestCase.builder()
                            .name(file.getName())
                            .type("SCRIPT")
                            .script(file.getName())
                            .description("Custom script test: " + file.getName())
                            .build());
                }
            }
        }

        return tests;
    }
}
