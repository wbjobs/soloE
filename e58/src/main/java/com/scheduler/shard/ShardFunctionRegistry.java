package com.scheduler.shard;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

@Slf4j
@Service
public class ShardFunctionRegistry {

    private final Map<String, ShardFunction> shardFunctions = new ConcurrentHashMap<>();
    private final Map<String, MergeFunction> mergeFunctions = new ConcurrentHashMap<>();

    public ShardFunctionRegistry(List<ShardFunction> shardFunctions, List<MergeFunction> mergeFunctions) {
        shardFunctions.forEach(this::registerShardFunction);
        mergeFunctions.forEach(this::registerMergeFunction);
        log.info("Registered {} shard functions and {} merge functions",
                shardFunctions.size(), mergeFunctions.size());
    }

    public void registerShardFunction(ShardFunction function) {
        shardFunctions.put(function.getName(), function);
        log.info("Registered shard function: {}", function.getName());
    }

    public void registerMergeFunction(MergeFunction function) {
        mergeFunctions.put(function.getName(), function);
        log.info("Registered merge function: {}", function.getName());
    }

    public ShardFunction getShardFunction(String name) {
        return shardFunctions.get(name);
    }

    public MergeFunction getMergeFunction(String name) {
        return mergeFunctions.get(name);
    }

    public List<String> getShardFunctionNames() {
        return shardFunctions.keySet().stream().sorted().collect(Collectors.toList());
    }

    public List<String> getMergeFunctionNames() {
        return mergeFunctions.keySet().stream().sorted().collect(Collectors.toList());
    }
}
