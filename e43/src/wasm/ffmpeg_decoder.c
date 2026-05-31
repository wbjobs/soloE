#include <emscripten/emscripten.h>
#include <emscripten/bind.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <queue>

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavutil/frame.h>
#include <libavutil/imgutils.h>
#include <libswscale/swscale.h>
}

using namespace emscripten;

struct FrameData {
    AVFrame* frame;
    uint8_t* y_copy;
    uint8_t* u_copy;
    uint8_t* v_copy;
    int width;
    int height;
    int64_t pts;
    bool in_use;
};

class H265Decoder {
private:
    AVCodecContext* codec_ctx;
    AVFrame* temp_frame;
    AVPacket* packet;
    int width;
    int height;
    bool initialized;
    std::queue<FrameData*> frame_pool;
    std::queue<FrameData*> active_frames;
    static const int MAX_POOL_SIZE = 30;

    FrameData* allocate_frame_data() {
        if (!frame_pool.empty()) {
            FrameData* fd = frame_pool.front();
            frame_pool.pop();
            fd->in_use = true;
            return fd;
        }

        if (active_frames.size() >= MAX_POOL_SIZE) {
            return nullptr;
        }

        FrameData* fd = new FrameData();
        int y_size = width * height;
        int uv_size = (width / 2) * (height / 2);
        
        fd->y_copy = new uint8_t[y_size];
        fd->u_copy = new uint8_t[uv_size];
        fd->v_copy = new uint8_t[uv_size];
        fd->width = width;
        fd->height = height;
        fd->in_use = true;
        fd->frame = nullptr;
        
        return fd;
    }

    void copy_frame_data(FrameData* fd, AVFrame* src) {
        int y_size = width * height;
        int uv_size = (width / 2) * (height / 2);
        
        int y_linesize = src->linesize[0];
        int uv_linesize = src->linesize[1];
        
        for (int i = 0; i < height; i++) {
            memcpy(fd->y_copy + i * width, src->data[0] + i * y_linesize, width);
        }
        
        for (int i = 0; i < height / 2; i++) {
            memcpy(fd->u_copy + i * (width / 2), src->data[1] + i * uv_linesize, width / 2);
            memcpy(fd->v_copy + i * (width / 2), src->data[2] + i * uv_linesize, width / 2);
        }
        
        fd->pts = src->best_effort_timestamp;
    }

public:
    H265Decoder() : codec_ctx(nullptr), temp_frame(nullptr), packet(nullptr), 
                   width(0), height(0), initialized(false) {}

    bool init(int w, int h) {
        release_all_frames();
        
        width = w;
        height = h;

        const AVCodec* codec = avcodec_find_decoder_by_name("hevc");
        if (!codec) {
            return false;
        }

        codec_ctx = avcodec_alloc_context3(codec);
        if (!codec_ctx) {
            return false;
        }

        codec_ctx->width = width;
        codec_ctx->height = height;
        codec_ctx->pix_fmt = AV_PIX_FMT_YUV420P;

        int ret = avcodec_open2(codec_ctx, codec, nullptr);
        if (ret < 0) {
            avcodec_free_context(&codec_ctx);
            codec_ctx = nullptr;
            return false;
        }

        temp_frame = av_frame_alloc();
        packet = av_packet_alloc();
        if (!temp_frame || !packet) {
            close();
            return false;
        }

        initialized = true;
        return true;
    }

    val decode(uintptr_t data_ptr, int data_size) {
        if (!initialized) {
            return val::null();
        }

        uint8_t* data = reinterpret_cast<uint8_t*>(data_ptr);
        
        packet->data = data;
        packet->size = data_size;

        int frame_finished = 0;
        int ret = avcodec_decode_video2(codec_ctx, temp_frame, &frame_finished, packet);
        
        if (ret < 0 || !frame_finished) {
            return val::null();
        }

        FrameData* fd = allocate_frame_data();
        if (!fd) {
            av_frame_unref(temp_frame);
            return val::null();
        }

        copy_frame_data(fd, temp_frame);
        active_frames.push(fd);

        av_frame_unref(temp_frame);

        int y_size = width * height;
        int uv_size = (width / 2) * (height / 2);

        val result = val::object();
        result.set("y", val(typed_memory_view(y_size, fd->y_copy)));
        result.set("u", val(typed_memory_view(uv_size, fd->u_copy)));
        result.set("v", val(typed_memory_view(uv_size, fd->v_copy)));
        result.set("width", width);
        result.set("height", height);
        result.set("pts", fd->pts);
        result.set("frameId", reinterpret_cast<uintptr_t>(fd));

        return result;
    }

    void release_frame(uintptr_t frame_id) {
        FrameData* fd = reinterpret_cast<FrameData*>(frame_id);
        if (!fd || !fd->in_use) return;

        fd->in_use = false;
        
        auto it = active_frames.front();
        if (it == fd && active_frames.size() > 0) {
            active_frames.pop();
            if (frame_pool.size() < MAX_POOL_SIZE) {
                frame_pool.push(fd);
            } else {
                delete[] fd->y_copy;
                delete[] fd->u_copy;
                delete[] fd->v_copy;
                delete fd;
            }
        }
    }

    val flush() {
        if (!initialized) {
            return val::array();
        }

        val frames = val::array();
        int frame_finished = 0;

        packet->data = nullptr;
        packet->size = 0;

        while (true) {
            int ret = avcodec_decode_video2(codec_ctx, temp_frame, &frame_finished, packet);
            if (ret < 0 || !frame_finished) {
                break;
            }

            FrameData* fd = allocate_frame_data();
            if (!fd) {
                av_frame_unref(temp_frame);
                continue;
            }

            copy_frame_data(fd, temp_frame);
            active_frames.push(fd);

            av_frame_unref(temp_frame);

            int y_size = width * height;
            int uv_size = (width / 2) * (height / 2);

            val frame_obj = val::object();
            frame_obj.set("y", val(typed_memory_view(y_size, fd->y_copy)));
            frame_obj.set("u", val(typed_memory_view(uv_size, fd->u_copy)));
            frame_obj.set("v", val(typed_memory_view(uv_size, fd->v_copy)));
            frame_obj.set("width", width);
            frame_obj.set("height", height);
            frame_obj.set("pts", fd->pts);
            frame_obj.set("frameId", reinterpret_cast<uintptr_t>(fd));

            frames.call<void>("push", frame_obj);
        }

        return frames;
    }

    void release_all_frames() {
        while (!active_frames.empty()) {
            FrameData* fd = active_frames.front();
            active_frames.pop();
            delete[] fd->y_copy;
            delete[] fd->u_copy;
            delete[] fd->v_copy;
            delete fd;
        }
        
        while (!frame_pool.empty()) {
            FrameData* fd = frame_pool.front();
            frame_pool.pop();
            delete[] fd->y_copy;
            delete[] fd->u_copy;
            delete[] fd->v_copy;
            delete fd;
        }
    }

    int get_pool_size() {
        return frame_pool.size();
    }

    int get_active_count() {
        return active_frames.size();
    }

    void close() {
        release_all_frames();
        
        if (packet) {
            av_packet_free(&packet);
            packet = nullptr;
        }
        if (temp_frame) {
            av_frame_free(&temp_frame);
            temp_frame = nullptr;
        }
        if (codec_ctx) {
            avcodec_close(codec_ctx);
            avcodec_free_context(&codec_ctx);
            codec_ctx = nullptr;
        }
        initialized = false;
    }

    ~H265Decoder() {
        close();
    }
};

EMSCRIPTEN_BINDINGS(h265_decoder) {
    class_<H265Decoder>("H265Decoder")
        .constructor<>()
        .function("init", &H265Decoder::init)
        .function("decode", &H265Decoder::decode)
        .function("releaseFrame", &H265Decoder::release_frame)
        .function("releaseAllFrames", &H265Decoder::release_all_frames)
        .function("flush", &H265Decoder::flush)
        .function("getPoolSize", &H265Decoder::get_pool_size)
        .function("getActiveCount", &H265Decoder::get_active_count)
        .function("close", &H265Decoder::close);
}
