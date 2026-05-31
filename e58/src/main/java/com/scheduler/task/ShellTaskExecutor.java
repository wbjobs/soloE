package com.scheduler.task;

import com.alibaba.fastjson2.JSON;
import com.scheduler.entity.TaskInstance;
import com.scheduler.enums.TaskType;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.exec.CommandLine;
import org.apache.commons.exec.DefaultExecutor;
import org.apache.commons.exec.PumpStreamHandler;
import org.springframework.stereotype.Component;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;

@Slf4j
@Component
public class ShellTaskExecutor implements TaskExecutor {

    @Override
    public String execute(TaskInstance task) throws Exception {
        log.info("Executing Shell task: {}", task.getId());

        ShellTaskPayload payload = JSON.parseObject(task.getPayload(), ShellTaskPayload.class);

        CommandLine commandLine = CommandLine.parse(payload.getCommand());
        if (payload.getArguments() != null) {
            payload.getArguments().forEach(commandLine::addArgument);
        }

        ByteArrayOutputStream stdout = new ByteArrayOutputStream();
        ByteArrayOutputStream stderr = new ByteArrayOutputStream();
        PumpStreamHandler streamHandler = new PumpStreamHandler(stdout, stderr);

        DefaultExecutor executor = new DefaultExecutor();
        executor.setStreamHandler(streamHandler);
        executor.setWorkingDirectory(new java.io.File(payload.getWorkingDirectory() != null ? payload.getWorkingDirectory() : "."));

        if (payload.getTimeout() != null && payload.getTimeout() > 0) {
            executor.setWatchdog(new org.apache.commons.exec.ExecuteWatchdog(payload.getTimeout()));
        }

        int exitCode = executor.execute(commandLine);
        String output = stdout.toString(StandardCharsets.UTF_8);
        String error = stderr.toString(StandardCharsets.UTF_8);

        log.info("Shell task completed: {}, exitCode: {}", task.getId(), exitCode);

        return JSON.toJSONString(Map.of(
                "exitCode", exitCode,
                "stdout", output,
                "stderr", error
        ));
    }

    @Override
    public boolean supports(String type) {
        return TaskType.SHELL.name().equals(type);
    }

    public static class ShellTaskPayload {
        private String command;
        private String[] arguments;
        private String workingDirectory;
        private Long timeout;

        public String getCommand() { return command; }
        public void setCommand(String command) { this.command = command; }
        public String[] getArguments() { return arguments; }
        public void setArguments(String[] arguments) { this.arguments = arguments; }
        public String getWorkingDirectory() { return workingDirectory; }
        public void setWorkingDirectory(String workingDirectory) { this.workingDirectory = workingDirectory; }
        public Long getTimeout() { return timeout; }
        public void setTimeout(Long timeout) { this.timeout = timeout; }
    }
}
