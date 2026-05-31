#include "fasta_parser.h"
#include <algorithm>
#include <sstream>
#include <cctype>

namespace gene {

uint8_t FastaParser::encode_char(char c, SequenceType type) {
    c = std::toupper(c);
    switch (c) {
        case 'A': return static_cast<uint8_t>(Nucleotide::A);
        case 'T': return static_cast<uint8_t>(Nucleotide::T);
        case 'G': return static_cast<uint8_t>(Nucleotide::G);
        case 'C': return static_cast<uint8_t>(Nucleotide::C);
        case 'U': return static_cast<uint8_t>(Nucleotide::U);
        case 'N': return static_cast<uint8_t>(Nucleotide::N);
        case '-': return static_cast<uint8_t>(Nucleotide::GAP);
        default: return static_cast<uint8_t>(Nucleotide::INVALID);
    }
}

std::string FastaParser::decode_char(uint8_t code) {
    switch (static_cast<Nucleotide>(code)) {
        case Nucleotide::A: return "A";
        case Nucleotide::T: return "T";
        case Nucleotide::G: return "G";
        case Nucleotide::C: return "C";
        case Nucleotide::U: return "U";
        case Nucleotide::N: return "N";
        case Nucleotide::GAP: return "-";
        default: return "?";
    }
}

std::string FastaParser::compress_sequence(const std::string& seq) {
    std::string result;
    result.reserve(seq.size());
    for (char c : seq) {
        if (!std::isspace(c)) {
            result += c;
        }
    }
    return result;
}

std::vector<Sequence> FastaParser::parse_file(const std::string& filename, SequenceType type) {
    std::vector<Sequence> sequences;
    std::ifstream file(filename);
    if (!file.is_open()) {
        throw std::runtime_error("Cannot open file: " + filename);
    }

    std::string line;
    Sequence current_seq;
    bool in_sequence = false;

    while (std::getline(file, line)) {
        if (line.empty()) continue;

        if (line[0] == '>') {
            if (in_sequence) {
                current_seq.raw_sequence = compress_sequence(current_seq.raw_sequence);
                for (char c : current_seq.raw_sequence) {
                    current_seq.encoded.push_back(encode_char(c, type));
                }
                current_seq.type = type;
                sequences.push_back(current_seq);
            }

            current_seq = Sequence();
            size_t space_pos = line.find(' ');
            if (space_pos != std::string::npos) {
                current_seq.id = line.substr(1, space_pos - 1);
                current_seq.description = line.substr(space_pos + 1);
            } else {
                current_seq.id = line.substr(1);
            }
            current_seq.raw_sequence.clear();
            current_seq.encoded.clear();
            in_sequence = true;
        } else if (in_sequence) {
            current_seq.raw_sequence += line;
        }
    }

    if (in_sequence && !current_seq.id.empty()) {
        current_seq.raw_sequence = compress_sequence(current_seq.raw_sequence);
        for (char c : current_seq.raw_sequence) {
            current_seq.encoded.push_back(encode_char(c, type));
        }
        current_seq.type = type;
        sequences.push_back(current_seq);
    }

    return sequences;
}

void FastaParser::write_fasta(const std::string& filename, 
                              const std::vector<Sequence>& sequences,
                              size_t line_width) {
    std::ofstream file(filename);
    if (!file.is_open()) {
        throw std::runtime_error("Cannot open file for writing: " + filename);
    }

    for (const auto& seq : sequences) {
        file << ">" << seq.id;
        if (!seq.description.empty()) {
            file << " " << seq.description;
        }
        file << "\n";

        for (size_t i = 0; i < seq.raw_sequence.size(); i += line_width) {
            file << seq.raw_sequence.substr(i, line_width) << "\n";
        }
    }
}

std::vector<Sequence> FastqParser::parse_file(const std::string& filename, SequenceType type) {
    std::vector<Sequence> sequences;
    std::ifstream file(filename);
    if (!file.is_open()) {
        throw std::runtime_error("Cannot open file: " + filename);
    }

    std::string line;
    while (std::getline(file, line)) {
        if (line.empty()) continue;

        if (line[0] == '@') {
            Sequence seq;
            size_t space_pos = line.find(' ');
            if (space_pos != std::string::npos) {
                seq.id = line.substr(1, space_pos - 1);
                seq.description = line.substr(space_pos + 1);
            } else {
                seq.id = line.substr(1);
            }

            if (!std::getline(file, line)) break;
            seq.raw_sequence = line;
            for (char c : seq.raw_sequence) {
                seq.encoded.push_back(FastaParser::encode_char(c, type));
            }
            seq.type = type;

            if (!std::getline(file, line)) break;
            if (!std::getline(file, line)) break;
            
            seq.quality.reserve(line.size());
            for (char c : line) {
                seq.quality.push_back(static_cast<uint8_t>(c));
            }

            sequences.push_back(seq);
        }
    }

    return sequences;
}

void FastqParser::write_fastq(const std::string& filename,
                               const std::vector<Sequence>& sequences) {
    std::ofstream file(filename);
    if (!file.is_open()) {
        throw std::runtime_error("Cannot open file for writing: " + filename);
    }

    for (const auto& seq : sequences) {
        file << "@" << seq.id;
        if (!seq.description.empty()) {
            file << " " << seq.description;
        }
        file << "\n";
        file << seq.raw_sequence << "\n";
        file << "+\n";
        for (uint8_t q : seq.quality) {
            file << static_cast<char>(q);
        }
        file << "\n";
    }
}

}
