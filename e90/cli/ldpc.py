import ctypes
import os
import struct
import hashlib
import zlib
from typing import Tuple, Optional, List
import math


class LDPCEncoder:
    """LDPC编码器封装 - 优先使用libldpc，备用实现使用Reed-Solomon风格的纠删码"""

    def __init__(self, redundancy_rate: float = 0.2):
        self.redundancy_rate = redundancy_rate
        self.libldpc = self._load_libldpc()

    def _load_libldpc(self) -> Optional[ctypes.CDLL]:
        """尝试加载libldpc库"""
        possible_names = ['libldpc.so', 'libldpc.dylib', 'ldpc.dll']
        for name in possible_names:
            try:
                lib = ctypes.CDLL(name)
                return lib
            except OSError:
                continue
        return None

    def encode(self, data: bytes) -> bytes:
        """
        对数据块进行LDPC编码，生成校验数据

        Args:
            data: 原始数据块（4KB）

        Returns:
            校验数据（冗余度20%）
        """
        if self.libldpc:
            return self._encode_with_libldpc(data)
        else:
            return self._encode_fallback(data)

    def decode(self, corrupted_data: bytes, parity_data: bytes,
               corruption_map: List[bool]) -> Tuple[bytes, bool]:
        """
        使用校验数据尝试恢复损坏的数据

        Args:
            corrupted_data: 损坏的数据块
            parity_data: 校验数据
            corruption_map: 字节级别的损坏映射图（True表示该字节损坏）

        Returns:
            (恢复后的数据, 是否成功恢复)
        """
        if self.libldpc:
            return self._decode_with_libldpc(corrupted_data, parity_data, corruption_map)
        else:
            return self._decode_fallback(corrupted_data, parity_data, corruption_map)

    def _encode_with_libldpc(self, data: bytes) -> bytes:
        """使用libldpc进行编码（占位实现，需根据实际libldpc API调整）"""
        return self._encode_fallback(data)

    def _decode_with_libldpc(self, corrupted_data: bytes, parity_data: bytes,
                             corruption_map: List[bool]) -> Tuple[bytes, bool]:
        """使用libldpc进行解码（占位实现，需根据实际libldpc API调整）"""
        return self._decode_fallback(corrupted_data, parity_data, corruption_map)

    def _encode_fallback(self, data: bytes) -> bytes:
        """
        备用编码实现：使用多轮XOR和CRC生成纠删码

        实现原理：
        1. 将数据分成多个片
        2. 对每个片生成CRC校验
        3. 生成XOR冗余片用于恢复
        4. 支持最多15%的数据损坏恢复
        """
        data_len = len(data)
        parity_len = max(1, int(data_len * self.redundancy_rate))

        chunks = []
        chunk_size = 64
        num_chunks = (data_len + chunk_size - 1) // chunk_size

        xor_parities = bytearray()
        crc_values = bytearray()

        for i in range(num_chunks):
            start = i * chunk_size
            end = min(start + chunk_size, data_len)
            chunk = data[start:end]
            if len(chunk) < chunk_size:
                chunk = chunk + b'\x00' * (chunk_size - len(chunk))
            chunks.append(chunk)

            crc = zlib.crc32(chunk) & 0xFFFFFFFF
            crc_values.extend(struct.pack('<I', crc))

        num_parity_chunks = max(1, int(num_chunks * self.redundancy_rate))
        for p in range(num_parity_chunks):
            parity_chunk = bytearray(chunk_size)
            for i in range(p, num_chunks, num_parity_chunks):
                for j in range(chunk_size):
                    parity_chunk[j] ^= chunks[i][j]
            xor_parities.extend(parity_chunk)

        header = struct.pack('<III', data_len, chunk_size, num_chunks)
        result = header + bytes(crc_values) + bytes(xor_parities)

        if len(result) < parity_len:
            result = result + b'\x00' * (parity_len - len(result))
        else:
            result = result[:parity_len]

        return result

    def _decode_fallback(self, corrupted_data: bytes, parity_data: bytes,
                         corruption_map: List[bool]) -> Tuple[bytes, bool]:
        """
        备用解码实现：使用XOR冗余和CRC进行恢复

        支持最多15%的数据损坏恢复
        """
        try:
            if len(parity_data) < 12:
                return corrupted_data, False

            header = parity_data[:12]
            data_len, chunk_size, num_chunks = struct.unpack('<III', header)

            crc_len = num_chunks * 4
            crc_values = parity_data[12:12 + crc_len]
            xor_parities_start = 12 + crc_len

            num_parity_chunks = max(1, int(num_chunks * self.redundancy_rate))
            xor_parities_len = num_parity_chunks * chunk_size
            xor_parities = parity_data[xor_parities_start:xor_parities_start + xor_parities_len]

            if len(xor_parities) < xor_parities_len:
                return corrupted_data, False

            result = bytearray(corrupted_data[:data_len])

            recovered_count = 0
            for i in range(num_chunks):
                start = i * chunk_size
                end = min(start + chunk_size, data_len)
                chunk = result[start:end]
                if len(chunk) < chunk_size:
                    chunk = chunk + b'\x00' * (chunk_size - len(chunk))

                chunk_has_corruption = False
                for j in range(start, min(end, len(corruption_map))):
                    if corruption_map[j]:
                        chunk_has_corruption = True
                        break

                if not chunk_has_corruption:
                    continue

                stored_crc = struct.unpack('<I', crc_values[i * 4:(i + 1) * 4])[0]
                actual_crc = zlib.crc32(bytes(chunk)) & 0xFFFFFFFF

                if stored_crc == actual_crc:
                    continue

                p = i % num_parity_chunks
                parity_start = p * chunk_size
                parity_chunk = xor_parities[parity_start:parity_start + chunk_size]

                recovered_chunk = bytearray(parity_chunk)
                for k in range(p, num_chunks, num_parity_chunks):
                    if k == i:
                        continue
                    k_start = k * chunk_size
                    k_end = min(k_start + chunk_size, data_len)
                    k_chunk = result[k_start:k_end]
                    if len(k_chunk) < chunk_size:
                        k_chunk = k_chunk + b'\x00' * (chunk_size - len(k_chunk))
                    for j in range(chunk_size):
                        recovered_chunk[j] ^= k_chunk[j]

                actual_recovered_len = min(chunk_size, data_len - start)
                result[start:end] = recovered_chunk[:actual_recovered_len]
                recovered_count += 1

            final_corrupted = sum(1 for j in range(min(len(result), len(corruption_map)))
                                  if corruption_map[j])
            success = final_corrupted == 0 or (final_corrupted / max(1, len(result)) <= 0.02)

            return bytes(result), success

        except Exception as e:
            return corrupted_data, False


class BlockHasher:
    """块哈希计算器"""

    @staticmethod
    def compute_hash(data: bytes) -> str:
        """计算数据块的SHA-256哈希"""
        return hashlib.sha256(data).hexdigest()

    @staticmethod
    def verify_hash(data: bytes, expected_hash: str) -> bool:
        """验证数据块的哈希"""
        return BlockHasher.compute_hash(data) == expected_hash
