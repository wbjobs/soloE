#pragma once

#include "common.h"
#include <string>
#include <vector>
#include <fstream>

namespace gene {

class FastaParser {
public:
    static std::vector<Sequence> parse_file(const std::string& filename, 
                                             SequenceType type = SequenceType::DNA);
    
    static void write_fasta(const std::string& filename, 
                            const std::vector<Sequence>& sequences,
                            size_t line_width = 80);

private:
    static uint8_t encode_char(char c, SequenceType type);
    static std::string decode_char(uint8_t code);
    static std::string compress_sequence(const std::string& seq);
};

class FastqParser {
public:
    static std::vector<Sequence> parse_file(const std::string& filename,
                                             SequenceType type = SequenceType::DNA);
    
    static void write_fastq(const std::string& filename,
                            const std::vector<Sequence>& sequences);
};

}
