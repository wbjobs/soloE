package com.scheduler.enums;

public enum TaskPriority {
    LOW(10),
    MEDIUM(50),
    HIGH(100);

    private final int value;

    TaskPriority(int value) {
        this.value = value;
    }

    public int getValue() {
        return value;
    }
}
