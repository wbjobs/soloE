cmake_minimum_required(VERSION 3.14)
project(TimeSeriesCompressionBenchmark)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(MSVC)
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} /O2")
else()
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -O3 -march=native")
endif()

include_directories(${PROJECT_SOURCE_DIR}/include)

find_package(benchmark QUIET)

set(SOURCES
    src/compression/simple8b.cpp
    src/compression/gorilla.cpp
    src/compression/delta_delta.cpp
    src/csv_reader.cpp
    src/benchmark_framework.cpp
)

add_library(compression_lib STATIC ${SOURCES})

if(benchmark_FOUND)
    add_executable(ts_compression_benchmark
        benchmark/main_benchmark.cpp
        ${SOURCES}
    )
    target_link_libraries(ts_compression_benchmark benchmark::benchmark)
    if(WIN32)
        target_link_libraries(ts_compression_benchmark psapi)
    endif()
else()
    message(WARNING "Google Benchmark not found, skipping benchmark target")
endif()

add_executable(test_compression
    src/test_main.cpp
    ${SOURCES}
)

if(WIN32)
    target_link_libraries(test_compression psapi)
endif()

add_executable(test_gorilla_special
    src/test_gorilla_special.cpp
    src/compression/gorilla.cpp
)

if(WIN32)
    target_link_libraries(test_gorilla_special psapi)
endif()
