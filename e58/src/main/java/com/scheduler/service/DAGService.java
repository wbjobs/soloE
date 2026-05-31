package com.scheduler.service;

import com.scheduler.entity.DAG;
import com.scheduler.entity.DAGEdge;
import com.scheduler.entity.TaskInstance;
import com.scheduler.enums.TaskStatus;
import com.scheduler.repository.DAGEdgeRepository;
import com.scheduler.repository.DAGRepository;
import com.scheduler.repository.TaskInstanceRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

@Slf4j
@Service
@RequiredArgsConstructor
public class DAGService {

    private final DAGRepository dagRepository;
    private final DAGEdgeRepository dagEdgeRepository;
    private final TaskInstanceRepository taskInstanceRepository;
    private final TaskQueueService taskQueueService;

    @Transactional
    public DAG createDAG(String name, String description) {
        DAG dag = new DAG();
        dag.setName(name);
        dag.setDescription(description);
        dag.setEnabled(true);
        return dagRepository.save(dag);
    }

    @Transactional
    public void addEdge(String dagId, String fromTask, String toTask) {
        DAGEdge edge = new DAGEdge();
        edge.setDagId(dagId);
        edge.setFromTask(fromTask);
        edge.setToTask(toTask);
        dagEdgeRepository.save(edge);
    }

    @Transactional
    public void submitDAG(String dagId, List<TaskInstance> tasks) {
        for (TaskInstance task : tasks) {
            task.setDagId(dagId);
            taskInstanceRepository.save(task);
        }

        startReadyTasks(dagId);
    }

    public void startReadyTasks(String dagId) {
        List<TaskInstance> allTasks = taskInstanceRepository.findByDagId(dagId);

        for (TaskInstance task : allTasks) {
            if (task.getStatus() == TaskStatus.PENDING && areAllDependenciesCompleted(task)) {
                log.info("Starting task {} in DAG {}", task.getTaskName(), dagId);
                taskQueueService.submitTask(task);
            }
        }
    }

    private boolean areAllDependenciesCompleted(TaskInstance task) {
        List<String> predecessors = dagEdgeRepository.findPredecessorTasks(task.getDagId(), task.getTaskName());

        for (String predecessorName : predecessors) {
            Optional<TaskInstance> predecessor = taskInstanceRepository.findByDagIdAndTaskName(
                    task.getDagId(), predecessorName);

            if (predecessor.isEmpty() || predecessor.get().getStatus() != TaskStatus.COMPLETED) {
                return false;
            }
        }

        return true;
    }

    @EventListener
    @Transactional
    public void onTaskComplete(TaskCompletionListener.TaskCompletedEvent event) {
        TaskInstance task = event.getTask();
        if (task.getDagId() == null) {
            return;
        }

        log.info("Task {} completed in DAG {}, checking successor tasks", task.getTaskName(), task.getDagId());
        startReadyTasks(task.getDagId());
    }

    public List<DAGEdge> getDAGEdges(String dagId) {
        return dagEdgeRepository.findByDagId(dagId);
    }

    public Optional<DAG> getDAG(String dagId) {
        return dagRepository.findById(dagId);
    }

    public List<TaskInstance> getDAGTasks(String dagId) {
        return taskInstanceRepository.findByDagId(dagId);
    }
}
