#!/bin/bash

# 使用Emscripten编译FFmpeg为WebAssembly

export EMCC_CFLAGS="-O3 \
    -s WASM=1 \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s MODULARIZE=1 \
    -s EXPORT_NAME='createFFmpegModule' \
    -s EXPORTED_FUNCTIONS='[_malloc,_free]' \
    -s EXPORTED_RUNTIME_METHODS='[ccall,cwrap,getValue,setValue,UTF8ToString,stringToUTF8]' \
    --bind"

emcc ffmpeg_decoder.c \
    -I/path/to/ffmpeg/include \
    -L/path/to/ffmpeg/lib \
    -lavcodec -lavutil -lswscale \
    $EMCC_CFLAGS \
    -o ffmpeg_decoder.js

echo "编译完成！生成 ffmpeg_decoder.js 和 ffmpeg_decoder.wasm"
