cmake_minimum_required(VERSION 3.18)
project(GeneAlignment VERSION 1.0.0 LANGUAGES CXX CUDA)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CUDA_STANDARD 17)
set(CMAKE_CUDA_STANDARD_REQUIRED ON)

find_package(CUDA REQUIRED)
find_package(Threads REQUIRED)

include_directories(${CUDA_INCLUDE_DIRS})
include_directories(${PROJECT_SOURCE_DIR}/include)

set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${PROJECT_SOURCE_DIR}/bin)
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY ${PROJECT_SOURCE_DIR}/lib)
set(CMAKE_ARCHIVE_OUTPUT_DIRECTORY ${PROJECT_SOURCE_DIR}/lib)

file(GLOB_RECURSE HEADER_FILES ${PROJECT_SOURCE_DIR}/include/*.h)
file(GLOB_RECURSE CPU_SOURCE_FILES ${PROJECT_SOURCE_DIR}/src/*.cpp)
file(GLOB_RECURSE CUDA_SOURCE_FILES ${PROJECT_SOURCE_DIR}/src/*.cu)

add_executable(gene_alignment
    ${HEADER_FILES}
    ${CPU_SOURCE_FILES}
    ${CUDA_SOURCE_FILES}
)

target_link_libraries(gene_alignment
    ${CUDA_LIBRARIES}
    Threads::Threads
)

set_target_properties(gene_alignment PROPERTIES
    CUDA_SEPARABLE_COMPILATION ON
    CUDA_ARCHITECTURES "75;80;86"
)

if(MSVC)
    target_compile_options(gene_alignment PRIVATE $<$<COMPILE_LANGUAGE:CUDA>:-Xcompiler=/W4>)
else()
    target_compile_options(gene_alignment PRIVATE $<$<COMPILE_LANGUAGE:CUDA>:-Xcompiler=-Wall;-Xcompiler=-Wextra>)
endif()

enable_testing()
add_subdirectory(test)
