package com.scheduler.task;

import com.scheduler.entity.TaskInstance;

public interface TaskExecutor {

    String execute(TaskInstance task) throws Exception;

    boolean supports(String type);
}
