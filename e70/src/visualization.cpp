#include "visualization.h"
#include <iostream>
#include <cstring>

namespace gene::viz {

HeatmapVisualizer::HeatmapVisualizer(const Config& config) : config_(config) {}

RGB HeatmapVisualizer::viridis_color(double t) {
    t = std::max(0.0, std::min(1.0, t));
    
    const std::vector<std::tuple<double, double, double>> colors = {
        {0.267004, 0.004874, 0.329415},
        {0.282323, 0.116575, 0.435773},
        {0.268510, 0.224401, 0.509616},
        {0.236609, 0.317321, 0.541854},
        {0.199430, 0.401669, 0.553693},
        {0.163625, 0.471133, 0.558148},
        {0.134692, 0.535825, 0.555298},
        {0.119428, 0.598863, 0.542846},
        {0.143343, 0.658636, 0.517093},
        {0.216827, 0.715888, 0.474708},
        {0.327963, 0.769423, 0.412402},
        {0.468378, 0.817338, 0.328506},
        {0.626786, 0.859153, 0.222990},
        {0.789888, 0.892602, 0.104888},
        {0.959347, 0.908551, 0.118128}
    };
    
    double idx = t * (colors.size() - 1);
    int i = static_cast<int>(std::floor(idx));
    double f = idx - i;
    
    if (i >= static_cast<int>(colors.size()) - 1) {
        auto [r, g, b] = colors.back();
        return RGB(static_cast<uint8_t>(r * 255), 
                   static_cast<uint8_t>(g * 255), 
                   static_cast<uint8_t>(b * 255));
    }
    
    auto [r1, g1, b1] = colors[i];
    auto [r2, g2, b2] = colors[i + 1];
    
    double r = r1 + (r2 - r1) * f;
    double g = g1 + (g2 - g1) * f;
    double b = b1 + (b2 - b1) * f;
    
    return RGB(static_cast<uint8_t>(r * 255), 
               static_cast<uint8_t>(g * 255), 
               static_cast<uint8_t>(b * 255));
}

RGB HeatmapVisualizer::rainbow_color(double t) {
    t = std::max(0.0, std::min(1.0, t));
    double h = t * 5.0;
    int i = static_cast<int>(h);
    double f = h - i;
    uint8_t p = static_cast<uint8_t>(0 * 255);
    uint8_t q = static_cast<uint8_t>((1 - f) * 255);
    uint8_t v = static_cast<uint8_t>(f * 255);
    
    switch (i) {
        case 0: return RGB(255, v, p);
        case 1: return RGB(q, 255, p);
        case 2: return RGB(p, 255, v);
        case 3: return RGB(p, q, 255);
        case 4: return RGB(v, p, 255);
        default: return RGB(255, 0, 255);
    }
}

RGB HeatmapVisualizer::get_color(int value, int min_val, int max_val) {
    if (max_val == min_val) {
        return RGB(128, 128, 128);
    }
    
    double t = static_cast<double>(value - min_val) / (max_val - min_val);
    
    if (config_.color_scheme == "rainbow") {
        return rainbow_color(t);
    }
    return viridis_color(t);
}

std::vector<std::pair<int, int>> HeatmapVisualizer::trace_alignment_path(
    const std::vector<std::vector<int>>& matrix,
    const Sequence& query,
    const Sequence& target,
    int query_start,
    int target_start,
    int query_end,
    int target_end) {
    
    std::vector<std::pair<int, int>> path;
    
    if (matrix.empty() || matrix[0].empty()) {
        return path;
    }
    
    int rows = static_cast<int>(matrix.size());
    int cols = static_cast<int>(matrix[0].size());
    
    int q_start = std::max(0, std::min(rows - 1, query_start));
    int t_start = std::max(0, std::min(cols - 1, target_start));
    int q_end = std::max(0, std::min(rows - 1, query_end));
    int t_end = std::max(0, std::min(cols - 1, target_end));
    
    int i = q_end;
    int j = t_end;
    
    while (i >= q_start && j >= t_start && (i > 0 || j > 0)) {
        path.emplace_back(j, i);
        
        int current = matrix[i][j];
        int diagonal = (i > 0 && j > 0) ? matrix[i-1][j-1] : -1e9;
        int up = (i > 0) ? matrix[i-1][j] : -1e9;
        int left = (j > 0) ? matrix[i][j-1] : -1e9;
        
        int max_val = std::max({diagonal, up, left});
        
        if (max_val == diagonal && i > 0 && j > 0) {
            i--;
            j--;
        } else if (max_val == up && i > 0) {
            i--;
        } else if (j > 0) {
            j--;
        } else {
            break;
        }
    }
    
    path.emplace_back(j, i);
    std::reverse(path.begin(), path.end());
    
    return path;
}

void HeatmapVisualizer::write_ppm_header(std::ofstream& file, int width, int height) {
    file << "P3\n" << width << " " << height << "\n255\n";
}

void HeatmapVisualizer::write_pixel(std::ofstream& file, const RGB& color) {
    file << static_cast<int>(color.r) << " " 
         << static_cast<int>(color.g) << " " 
         << static_cast<int>(color.b) << " ";
}

void HeatmapVisualizer::draw_rect(std::vector<std::vector<RGB>>& image,
                                   int x, int y, int w, int h, const RGB& color) {
    int height = static_cast<int>(image.size());
    int width = static_cast<int>(image[0].size());
    
    for (int dy = 0; dy < h; dy++) {
        for (int dx = 0; dx < w; dx++) {
            int px = x + dx;
            int py = y + dy;
            if (px >= 0 && px < width && py >= 0 && py < height) {
                image[py][px] = color;
            }
        }
    }
}

void HeatmapVisualizer::draw_line(std::vector<std::vector<RGB>>& image,
                                   int x1, int y1, int x2, int y2, 
                                   const RGB& color, int thickness) {
    int height = static_cast<int>(image.size());
    int width = static_cast<int>(image[0].size());
    
    int dx = std::abs(x2 - x1);
    int dy = std::abs(y2 - y1);
    int sx = (x1 < x2) ? 1 : -1;
    int sy = (y1 < y2) ? 1 : -1;
    int err = dx - dy;
    
    while (true) {
        for (int t = -thickness/2; t <= thickness/2; t++) {
            for (int s = -thickness/2; s <= thickness/2; s++) {
                int px = x1 + s;
                int py = y1 + t;
                if (px >= 0 && px < width && py >= 0 && py < height) {
                    image[py][px] = color;
                }
            }
        }
        
        if (x1 == x2 && y1 == y2) break;
        
        int e2 = 2 * err;
        if (e2 > -dy) {
            err -= dy;
            x1 += sx;
        }
        if (e2 < dx) {
            err += dx;
            y1 += sy;
        }
    }
}

int HeatmapVisualizer::get_text_width(const std::string& text) {
    return static_cast<int>(text.size()) * 6;
}

void HeatmapVisualizer::draw_text(std::vector<std::vector<RGB>>& image,
                                   int x, int y, const std::string& text, 
                                   const RGB& color) {
    static const char font[10][5] = {
        {0x7E, 0x11, 0x11, 0x11, 0x7E},
        {0x7F, 0x49, 0x49, 0x49, 0x36},
        {0x3E, 0x41, 0x41, 0x41, 0x22},
        {0x7F, 0x41, 0x41, 0x22, 0x1C},
        {0x7F, 0x49, 0x49, 0x49, 0x41},
        {0x7F, 0x09, 0x09, 0x01, 0x01},
        {0x3E, 0x41, 0x41, 0x51, 0x72},
        {0x7F, 0x08, 0x08, 0x08, 0x7F},
        {0x00, 0x41, 0x7F, 0x41, 0x00},
        {0x20, 0x40, 0x41, 0x3F, 0x01}
    };
    
    int height = static_cast<int>(image.size());
    int width = static_cast<int>(image[0].size());
    int char_width = 6;
    int char_height = 7;
    
    for (size_t char_idx = 0; char_idx < text.size(); char_idx++) {
        char c = text[char_idx];
        int char_x = x + static_cast<int>(char_idx) * char_width;
        
        for (int row = 0; row < 5; row++) {
            uint8_t bits = 0;
            if (c >= '0' && c <= '9') {
                bits = font[c - '0'][row];
            } else if (c >= 'A' && c <= 'Z') {
                bits = font[(c - 'A' + 10) % 10][row];
            } else if (c >= 'a' && c <= 'z') {
                bits = font[(c - 'a' + 10) % 10][row];
            }
            
            for (int col = 0; col < 7; col++) {
                if (bits & (1 << (6 - col))) {
                    int px = char_x + col;
                    int py = y + row;
                    if (px >= 0 && px < width && py >= 0 && py < height) {
                        image[py][px] = color;
                    }
                }
            }
        }
    }
}

void HeatmapVisualizer::generate_heatmap(const AlignmentResult& result,
                                          const Sequence& query,
                                          const Sequence& target,
                                          const std::string& output_file) {
    
    if (result.score_matrix.empty()) {
        throw std::runtime_error("Score matrix is empty, cannot generate heatmap");
    }
    
    size_t rows = result.score_matrix.size();
    size_t cols = result.score_matrix[0].size();
    
    int margin = config_.margin;
    int cell_size = config_.cell_size;
    int img_width = static_cast<int>(cols) * cell_size + 2 * margin;
    int img_height = static_cast<int>(rows) * cell_size + 2 * margin;
    
    std::vector<std::vector<RGB>> image(img_height, std::vector<RGB>(img_width, RGB(255, 255, 255)));
    
    int min_val = INT_MAX;
    int max_val = INT_MIN;
    for (const auto& row : result.score_matrix) {
        for (int val : row) {
            min_val = std::min(min_val, val);
            max_val = std::max(max_val, val);
        }
    }
    
    for (size_t i = 0; i < rows; i++) {
        for (size_t j = 0; j < cols; j++) {
            int x = margin + static_cast<int>(j) * cell_size;
            int y = margin + static_cast<int>(i) * cell_size;
            RGB color = get_color(result.score_matrix[i][j], min_val, max_val);
            draw_rect(image, x, y, cell_size, cell_size, color);
        }
    }
    
    if (config_.show_grid) {
        RGB grid_color(200, 200, 200);
        for (size_t i = 0; i <= rows; i++) {
            int y = margin + static_cast<int>(i) * cell_size;
            draw_line(image, margin, y, img_width - margin, y, grid_color, 1);
        }
        for (size_t j = 0; j <= cols; j++) {
            int x = margin + static_cast<int>(j) * cell_size;
            draw_line(image, x, margin, x, img_height - margin, grid_color, 1);
        }
    }
    
    if (config_.show_alignment_path && !result.score_matrix.empty()) {
        int q_start = static_cast<int>(result.query_start);
        int t_start = static_cast<int>(result.target_start);
        int q_end = static_cast<int>(result.query_end);
        int t_end = static_cast<int>(result.target_end);
        
        auto path = trace_alignment_path(result.score_matrix, query, target,
                                          q_start, t_start, q_end, t_end);
        
        RGB path_color(255, 0, 0);
        for (size_t k = 1; k < path.size(); k++) {
            int x1 = margin + path[k-1].first * cell_size + cell_size / 2;
            int y1 = margin + path[k-1].second * cell_size + cell_size / 2;
            int x2 = margin + path[k].first * cell_size + cell_size / 2;
            int y2 = margin + path[k].second * cell_size + cell_size / 2;
            draw_line(image, x1, y1, x2, y2, path_color, config_.path_thickness);
        }
    }
    
    if (config_.show_labels) {
        RGB text_color(0, 0, 0);
        
        std::string query_label = "Query: " + query.id;
        draw_text(image, margin, margin - 15, query_label, text_color);
        
        std::string target_label = "Target: " + target.id;
        draw_text(image, margin, 5, target_label, text_color);
        
        std::string score_label = "Score: " + std::to_string(result.score);
        draw_text(image, img_width - margin - get_text_width(score_label), 5, score_label, text_color);
        
        std::string q_start_label = std::to_string(result.query_start);
        draw_text(image, margin - 30, margin + static_cast<int>(result.query_start) * cell_size, q_start_label, text_color);
        
        std::string q_end_label = std::to_string(result.query_end);
        draw_text(image, margin - 30, margin + static_cast<int>(result.query_end) * cell_size, q_end_label, text_color);
        
        std::string t_start_label = std::to_string(result.target_start);
        draw_text(image, margin + static_cast<int>(result.target_start) * cell_size, img_height - margin + 5, t_start_label, text_color);
        
        std::string t_end_label = std::to_string(result.target_end);
        draw_text(image, margin + static_cast<int>(result.target_end) * cell_size, img_height - margin + 5, t_end_label, text_color);
    }
    
    std::ofstream file(output_file, std::ios::binary);
    if (!file.is_open()) {
        throw std::runtime_error("Cannot open output file: " + output_file);
    }
    
    write_ppm_header(file, img_width, img_height);
    for (int y = 0; y < img_height; y++) {
        for (int x = 0; x < img_width; x++) {
            write_pixel(file, image[y][x]);
        }
        file << "\n";
    }
}

void HeatmapVisualizer::generate_svg_heatmap(const AlignmentResult& result,
                                              const Sequence& query,
                                              const Sequence& target,
                                              const std::string& output_file) {
    
    if (result.score_matrix.empty()) {
        throw std::runtime_error("Score matrix is empty, cannot generate heatmap");
    }
    
    size_t rows = result.score_matrix.size();
    size_t cols = result.score_matrix[0].size();
    
    int margin = config_.margin;
    int cell_size = config_.cell_size;
    int svg_width = static_cast<int>(cols) * cell_size + 2 * margin;
    int svg_height = static_cast<int>(rows) * cell_size + 2 * margin;
    
    std::ofstream file(output_file);
    if (!file.is_open()) {
        throw std::runtime_error("Cannot open output file: " + output_file);
    }
    
    file << "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n";
    file << "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"" << svg_width 
         << "\" height=\"" << svg_height << "\">\n";
    
    file << "  <rect x=\"0\" y=\"0\" width=\"" << svg_width << "\" height=\"" 
         << svg_height << "\" fill=\"white\"/>\n";
    
    int min_val = INT_MAX;
    int max_val = INT_MIN;
    for (const auto& row : result.score_matrix) {
        for (int val : row) {
            min_val = std::min(min_val, val);
            max_val = std::max(max_val, val);
        }
    }
    
    for (size_t i = 0; i < rows; i++) {
        for (size_t j = 0; j < cols; j++) {
            int x = margin + static_cast<int>(j) * cell_size;
            int y = margin + static_cast<int>(i) * cell_size;
            RGB color = get_color(result.score_matrix[i][j], min_val, max_val);
            
            file << "  <rect x=\"" << x << "\" y=\"" << y 
                 << "\" width=\"" << cell_size << "\" height=\"" << cell_size 
                 << "\" fill=\"rgb(" << static_cast<int>(color.r) << "," 
                 << static_cast<int>(color.g) << "," << static_cast<int>(color.b) << ")\"/>\n";
        }
    }
    
    if (config_.show_alignment_path) {
        int q_start = static_cast<int>(result.query_start);
        int t_start = static_cast<int>(result.target_start);
        int q_end = static_cast<int>(result.query_end);
        int t_end = static_cast<int>(result.target_end);
        
        auto path = trace_alignment_path(result.score_matrix, query, target,
                                          q_start, t_start, q_end, t_end);
        
        if (!path.empty()) {
            file << "  <polyline points=\"";
            for (size_t k = 0; k < path.size(); k++) {
                int x = margin + path[k].first * cell_size + cell_size / 2;
                int y = margin + path[k].second * cell_size + cell_size / 2;
                if (k > 0) file << " ";
                file << x << "," << y;
            }
            file << "\" fill=\"none\" stroke=\"red\" stroke-width=\"" 
                 << config_.path_thickness << "\" stroke-linecap=\"round\"/>\n";
        }
    }
    
    if (config_.show_labels) {
        file << "  <text x=\"" << margin << "\" y=\"" << margin - 20 
             << "\" font-family=\"Arial\" font-size=\"12\" fill=\"black\">"
             << "Query: " << query.id << "</text>\n";
        
        file << "  <text x=\"" << margin << "\" y=\"20\" font-family=\"Arial\" "
             << "font-size=\"12\" fill=\"black\">"
             << "Target: " << target.id << "</text>\n";
        
        file << "  <text x=\"" << (svg_width - margin - 100) << "\" y=\"20\" "
             << "font-family=\"Arial\" font-size=\"12\" fill=\"black\">"
             << "Score: " << result.score << "</text>\n";
        
        file << "  <text x=\"" << (margin - 40) << "\" y=\"" 
             << (margin + static_cast<int>(result.query_start) * cell_size + 5) 
             << "\" font-family=\"Arial\" font-size=\"10\" fill=\"black\">"
             << result.query_start << "</text>\n";
        
        file << "  <text x=\"" << (margin - 40) << "\" y=\"" 
             << (margin + static_cast<int>(result.query_end) * cell_size + 5) 
             << "\" font-family=\"Arial\" font-size=\"10\" fill=\"black\">"
             << result.query_end << "</text>\n";
        
        file << "  <text x=\"" << (margin + static_cast<int>(result.target_start) * cell_size) 
             << "\" y=\"" << (svg_height - margin + 15) 
             << "\" font-family=\"Arial\" font-size=\"10\" fill=\"black\">"
             << result.target_start << "</text>\n";
        
        file << "  <text x=\"" << (margin + static_cast<int>(result.target_end) * cell_size) 
             << "\" y=\"" << (svg_height - margin + 15) 
             << "\" font-family=\"Arial\" font-size=\"10\" fill=\"black\">"
             << result.target_end << "</text>\n";
    }
    
    file << "</svg>\n";
}

AlignmentVisualizer::AlignmentVisualizer(const Config& config) : config_(config) {}

std::string AlignmentVisualizer::format_alignment(const AlignmentResult& result,
                                                    const Sequence& query,
                                                    const Sequence& target) {
    std::stringstream ss;
    
    ss << "Alignment: " << query.id << " vs " << target.id << "\n";
    ss << "Score: " << result.score << "\n";
    ss << "Identity: " << std::fixed << std::setprecision(2) 
       << (result.identity * 100) << "%\n\n";
    
    const std::string& aligned_query = result.aligned_query;
    const std::string& aligned_target = result.aligned_target;
    const std::string& midline = result.alignment_midline;
    
    int query_pos = static_cast<int>(result.query_start);
    int target_pos = static_cast<int>(result.target_start);
    
    for (size_t i = 0; i < aligned_query.size(); i += config_.chars_per_line) {
        size_t end = std::min(i + config_.chars_per_line, aligned_query.size());
        size_t len = end - i;
        
        if (config_.show_coordinates) {
            ss << std::setw(config_.coordinate_width) << query_pos << " ";
        }
        ss << aligned_query.substr(i, len) << "\n";
        
        if (config_.show_midline) {
            if (config_.show_coordinates) {
                ss << std::setw(config_.coordinate_width) << "" << " ";
            }
            ss << midline.substr(i, len) << "\n";
        }
        
        if (config_.show_coordinates) {
            ss << std::setw(config_.coordinate_width) << target_pos << " ";
        }
        ss << aligned_target.substr(i, len) << "\n\n";
        
        for (size_t j = i; j < end; j++) {
            if (aligned_query[j] != '-') query_pos++;
            if (aligned_target[j] != '-') target_pos++;
        }
    }
    
    return ss.str();
}

void AlignmentVisualizer::write_alignment(const AlignmentResult& result,
                                           const Sequence& query,
                                           const Sequence& target,
                                           const std::string& output_file) {
    std::ofstream file(output_file);
    if (!file.is_open()) {
        throw std::runtime_error("Cannot open output file: " + output_file);
    }
    file << format_alignment(result, query, target);
}

bool AlignmentPathValidator::validate_coordinates(const AlignmentResult& result,
                                                   const Sequence& query,
                                                   const Sequence& target) {
    if (result.query_start > result.query_end) {
        return false;
    }
    if (result.target_start > result.target_end) {
        return false;
    }
    if (result.query_end > query.length()) {
        return false;
    }
    if (result.target_end > target.length()) {
        return false;
    }
    
    int aligned_len = static_cast<int>(result.aligned_query.size());
    int query_span = static_cast<int>(result.query_end - result.query_start);
    int target_span = static_cast<int>(result.target_end - result.target_start);
    
    int query_gaps = 0;
    for (char c : result.aligned_query) {
        if (c == '-') query_gaps++;
    }
    
    int target_gaps = 0;
    for (char c : result.aligned_target) {
        if (c == '-') target_gaps++;
    }
    
    if (aligned_len - query_gaps != query_span) {
        return false;
    }
    
    if (aligned_len - target_gaps != target_span) {
        return false;
    }
    
    return true;
}

void AlignmentPathValidator::fix_coordinates(AlignmentResult& result,
                                              const Sequence& query,
                                              const Sequence& target) {
    int query_gaps = 0;
    for (char c : result.aligned_query) {
        if (c == '-') query_gaps++;
    }
    
    int target_gaps = 0;
    for (char c : result.aligned_target) {
        if (c == '-') target_gaps++;
    }
    
    size_t actual_query_span = result.aligned_query.size() - query_gaps;
    size_t actual_target_span = result.aligned_target.size() - target_gaps;
    
    if (result.query_end > query.length()) {
        result.query_end = query.length();
        result.query_start = (result.query_end > actual_query_span) ? 
                              result.query_end - actual_query_span : 0;
    }
    
    if (result.target_end > target.length()) {
        result.target_end = target.length();
        result.target_start = (result.target_end > actual_target_span) ? 
                               result.target_end - actual_target_span : 0;
    }
    
    if (result.query_start > result.query_end) {
        std::swap(result.query_start, result.query_end);
    }
    
    if (result.target_start > result.target_end) {
        std::swap(result.target_start, result.target_end);
    }
}

std::string AlignmentPathValidator::get_diagnostic_info(const AlignmentResult& result,
                                                         const Sequence& query,
                                                         const Sequence& target) {
    std::stringstream ss;
    
    ss << "=== Alignment Diagnostic Info ===\n";
    ss << "Query: " << query.id << " (length: " << query.length() << ")\n";
    ss << "Target: " << target.id << " (length: " << target.length() << ")\n";
    ss << "\nReported Coordinates:\n";
    ss << "  Query: " << result.query_start << " - " << result.query_end 
       << " (span: " << (result.query_end - result.query_start) << ")\n";
    ss << "  Target: " << result.target_start << " - " << result.target_end 
       << " (span: " << (result.target_end - result.target_start) << ")\n";
    
    int query_gaps = 0;
    for (char c : result.aligned_query) {
        if (c == '-') query_gaps++;
    }
    
    int target_gaps = 0;
    for (char c : result.aligned_target) {
        if (c == '-') target_gaps++;
    }
    
    ss << "\nAligned Sequences:\n";
    ss << "  Query length: " << result.aligned_query.size() 
       << " (gaps: " << query_gaps << ", residues: " 
       << (result.aligned_query.size() - query_gaps) << ")\n";
    ss << "  Target length: " << result.aligned_target.size() 
       << " (gaps: " << target_gaps << ", residues: " 
       << (result.aligned_target.size() - target_gaps) << ")\n";
    
    ss << "\nValidation: " << (validate_coordinates(result, query, target) ? 
                               "PASSED" : "FAILED") << "\n";
    
    return ss.str();
}

}
