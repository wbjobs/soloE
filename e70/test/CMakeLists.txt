include_directories(${PROJECT_SOURCE_DIR}/include)

add_executable(test_advanced_features
    test_advanced_features.cpp
    ../src/banded_alignment.cpp
    ../src/pair_end_aligner.cpp
    ../src/fasta_parser.cpp
)

target_link_libraries(test_advanced_features
    Threads::Threads
)

target_compile_features(test_advanced_features PRIVATE cxx_std_17)

add_test(NAME AdvancedFeaturesTest COMMAND test_advanced_features)

if(EXISTS ${PROJECT_SOURCE_DIR}/test/test_fixes.cpp)
    add_executable(test_fixes
        test_fixes.cpp
        ../src/banded_alignment.cpp
        ../src/pair_end_aligner.cpp
        ../src/fasta_parser.cpp
        ../src/gpu_memory_manager.cpp
        ../src/task_queue.cpp
        ../src/visualization.cpp
    )
    
    target_link_libraries(test_fixes
        Threads::Threads
        ${CUDA_LIBRARIES}
    )
    
    target_compile_features(test_fixes PRIVATE cxx_std_17)
    
    add_test(NAME FixesTest COMMAND test_fixes)
endif()
