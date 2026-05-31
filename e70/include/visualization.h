#pragma once

#include "common.h"
#include <vector>
#include <string>
#include <fstream>
#include <cmath>
#include <iomanip>
#include <sstream>
#include <algorithm>

namespace gene::viz {

struct RGB {
    uint8_t r, g, b;
    RGB(uint8_t r = 0, uint8_t g = 0, uint8_t b = 0) : r(r), g(g), b(b) {}
};

class HeatmapVisualizer {
public:
    struct Config {
        int cell_size = 8;
        int margin = 40;
        bool show_labels = true;
        bool show_grid = false;
        bool show_alignment_path = true;
        int path_thickness = 2;
        std::string color_scheme = "viridis";
    };

    HeatmapVisualizer(const Config& config = Config());
    
    void generate_heatmap(const AlignmentResult& result,
                          const Sequence& query,
                          const Sequence& target,
                          const std::string& output_file);
    
    void generate_svg_heatmap(const AlignmentResult& result,
                               const Sequence& query,
                               const Sequence& target,
                               const std::string& output_file);

    void set_config(const Config& config) { config_ = config; }

private:
    RGB get_color(int value, int min_val, int max_val);
    RGB viridis_color(double t);
    RGB rainbow_color(double t);
    
    std::vector<std::pair<int, int>> trace_alignment_path(
        const std::vector<std::vector<int>>& matrix,
        const Sequence& query,
        const Sequence& target,
        int query_start,
        int target_start,
        int query_end,
        int target_end);
    
    void write_ppm_header(std::ofstream& file, int width, int height);
    void write_pixel(std::ofstream& file, const RGB& color);
    void draw_rect(std::vector<std::vector<RGB>>& image,
                   int x, int y, int w, int h, const RGB& color);
    void draw_line(std::vector<std::vector<RGB>>& image,
                   int x1, int y1, int x2, int y2, 
                   const RGB& color, int thickness = 1);
    
    void draw_text(std::vector<std::vector<RGB>>& image,
                   int x, int y, const std::string& text, 
                   const RGB& color);
    
    int get_text_width(const std::string& text);

    Config config_;
};

class AlignmentVisualizer {
public:
    struct Config {
        int chars_per_line = 60;
        bool show_midline = true;
        bool show_coordinates = true;
        int coordinate_width = 6;
        char match_char = '|';
        char mismatch_char = '.';
        char gap_char = '-';
    };

    AlignmentVisualizer(const Config& config = Config());
    
    std::string format_alignment(const AlignmentResult& result,
                                  const Sequence& query,
                                  const Sequence& target);
    
    void write_alignment(const AlignmentResult& result,
                         const Sequence& query,
                         const Sequence& target,
                         const std::string& output_file);

private:
    Config config_;
};

class AlignmentPathValidator {
public:
    static bool validate_coordinates(const AlignmentResult& result,
                                      const Sequence& query,
                                      const Sequence& target);
    
    static void fix_coordinates(AlignmentResult& result,
                                 const Sequence& query,
                                 const Sequence& target);
    
    static std::string get_diagnostic_info(const AlignmentResult& result,
                                            const Sequence& query,
                                            const Sequence& target);
};

}
