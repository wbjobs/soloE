"""
联合解码器 - 多片段 LDPC 联合恢复算法

工作原理：
1. 收集来自多个节点的块片段
2. 对每个缺失块，尝试从多个片段中组合有效数据
3. 使用 LDPC 校验数据进行联合解码恢复
4. 类似 RAID 重建，但使用 LDPC 提供更强的纠错能力
"""
import hashlib
import zlib
import base64
from typing import List, Dict, Tuple, Optional, Set
from collections import defaultdict


class JointDecoder:
    """
    多片段联合解码器

    支持三种恢复策略（按优先级）：
    1. 直接使用完整的有效块（某个节点提供了完整正确的块）
    2. 多片段组合恢复（从多个节点的部分正确片段中组合）
    3. LDPC 校验恢复（使用存储的校验数据进行纠错）
    """

    def __init__(self, redundancy_rate: float = 0.2):
        self.redundancy_rate = redundancy_rate

    def collect_block_sources(self, block_index: int,
                              fragments: List[Dict]) -> List[Dict]:
        """
        收集指定块的所有来源片段

        Args:
            block_index: 块索引
            fragments: 所有片段列表

        Returns:
            该块的所有来源片段
        """
        return [f for f in fragments if f.get("block_index") == block_index]

    def verify_block(self, block_data: bytes, expected_hash: str) -> bool:
        """验证块数据的哈希"""
        actual_hash = hashlib.sha256(block_data).hexdigest()
        return actual_hash == expected_hash

    def try_direct_recovery(self, sources: List[Dict],
                            expected_hash: str) -> Tuple[Optional[bytes], bool]:
        """
        策略1：直接使用某个节点提供的完整有效块

        Args:
            sources: 该块的所有来源片段
            expected_hash: 期望的块哈希

        Returns:
            (恢复的数据, 是否成功)
        """
        for source in sources:
            try:
                if isinstance(source.get("block_data"), str):
                    block_data = base64.b64decode(source["block_data"])
                else:
                    block_data = source["block_data"]

                if self.verify_block(block_data, expected_hash):
                    return block_data, True
            except Exception:
                continue
        return None, False

    def try_combining_recovery(self, sources: List[Dict],
                               expected_hash: str,
                               block_size: int = 4096) -> Tuple[Optional[bytes], bool]:
        """
        策略2：多片段组合恢复

        从多个损坏的片段中，逐字节选择正确的字节进行组合

        Args:
            sources: 该块的所有来源片段
            expected_hash: 期望的块哈希
            block_size: 块大小

        Returns:
            (恢复的数据, 是否成功)
        """
        if len(sources) < 2:
            return None, False

        decoded_sources = []
        for source in sources:
            try:
                if isinstance(source.get("block_data"), str):
                    data = base64.b64decode(source["block_data"])
                else:
                    data = source["block_data"]
                if len(data) == block_size:
                    decoded_sources.append(data)
            except Exception:
                continue

        if len(decoded_sources) < 2:
            return None, False

        combined = bytearray(block_size)
        confidence = [0] * block_size

        for pos in range(block_size):
            votes = defaultdict(int)
            for src in decoded_sources:
                if pos < len(src):
                    votes[src[pos]] += 1

            if votes:
                best_byte, best_count = max(votes.items(), key=lambda x: x[1])
                combined[pos] = best_byte
                confidence[pos] = best_count

        if self.verify_block(bytes(combined), expected_hash):
            return bytes(combined), True

        for attempt in range(min(100, block_size)):
            modified = bytearray(combined)
            low_conf_positions = [i for i, c in enumerate(confidence) if c < len(decoded_sources)]

            if not low_conf_positions:
                break

            import random
            pos = random.choice(low_conf_positions)
            for src in decoded_sources:
                if pos < len(src):
                    modified[pos] = src[pos]
                    if self.verify_block(bytes(modified), expected_hash):
                        return bytes(modified), True

        return None, False

    def try_ldpc_recovery(self, sources: List[Dict],
                          parity_data: bytes,
                          expected_hash: str,
                          block_size: int = 4096) -> Tuple[Optional[bytes], bool]:
        """
        策略3：LDPC 校验恢复

        使用存储的 LDPC 校验数据进行纠错恢复

        Args:
            sources: 该块的所有来源片段
            parity_data: LDPC 校验数据
            expected_hash: 期望的块哈希
            block_size: 块大小

        Returns:
            (恢复的数据, 是否成功)
        """
        if not sources or not parity_data:
            return None, False

        best_source = None
        best_corruption = block_size

        for source in sources:
            try:
                if isinstance(source.get("block_data"), str):
                    data = base64.b64decode(source["block_data"])
                else:
                    data = source["block_data"]

                if len(data) == block_size:
                    corruption_map = self._estimate_corruption(data, sources, block_size)
                    corruption_count = sum(corruption_map)

                    if corruption_count < best_corruption:
                        best_source = data
                        best_corruption = corruption_count
            except Exception:
                continue

        if best_source is None:
            return None, False

        if best_corruption == 0:
            if self.verify_block(best_source, expected_hash):
                return best_source, True
            return None, False

        max_corruption = int(block_size * 0.15)
        if best_corruption > max_corruption:
            return None, False

        recovered = self._ldpc_decode(best_source, parity_data, block_size)
        if recovered and self.verify_block(recovered, expected_hash):
            return recovered, True

        return None, False

    def _estimate_corruption(self, data: bytes,
                             sources: List[Dict],
                             block_size: int) -> List[bool]:
        """
        估计数据中的损坏位置

        通过多源对比找出可能损坏的字节
        """
        corruption_map = [False] * block_size

        if len(sources) < 2:
            return corruption_map

        other_sources = []
        for src in sources:
            try:
                if isinstance(src.get("block_data"), str):
                    src_data = base64.b64decode(src["block_data"])
                else:
                    src_data = src["block_data"]
                if len(src_data) == block_size and src_data != data:
                    other_sources.append(src_data)
            except Exception:
                continue

        if not other_sources:
            return corruption_map

        for pos in range(block_size):
            votes = defaultdict(int)
            for src in other_sources:
                votes[src[pos]] += 1

            if votes:
                majority_byte, majority_count = max(votes.items(), key=lambda x: x[1])
                if data[pos] != majority_byte and majority_count >= len(other_sources) * 0.5:
                    corruption_map[pos] = True

        return corruption_map

    def _ldpc_decode(self, data: bytes, parity_data: bytes,
                     block_size: int) -> Optional[bytes]:
        """
        LDPC 解码（简化实现，使用备用纠删码算法）

        实际应用中应调用 libldpc 库
        """
        try:
            if len(parity_data) < 12:
                return None

            header = parity_data[:12]
            data_len, chunk_size, num_chunks = self._safe_unpack(header)

            if data_len != block_size:
                return None

            crc_len = num_chunks * 4
            if len(parity_data) < 12 + crc_len:
                return None

            crc_values = parity_data[12:12 + crc_len]
            xor_parities_start = 12 + crc_len

            num_parity_chunks = max(1, int(num_chunks * self.redundancy_rate))
            xor_parities_len = num_parity_chunks * chunk_size

            if len(parity_data) < xor_parities_start + xor_parities_len:
                return None

            xor_parities = parity_data[xor_parities_start:xor_parities_start + xor_parities_len]

            result = bytearray(data)
            chunks = []
            for i in range(num_chunks):
                start = i * chunk_size
                end = min(start + chunk_size, block_size)
                chunk = result[start:end]
                if len(chunk) < chunk_size:
                    chunk = chunk + b'\x00' * (chunk_size - len(chunk))
                chunks.append(chunk)

            for i in range(num_chunks):
                stored_crc = struct.unpack('<I', crc_values[i * 4:(i + 1) * 4])[0]
                actual_crc = zlib.crc32(bytes(chunks[i])) & 0xFFFFFFFF

                if stored_crc == actual_crc:
                    continue

                p = i % num_parity_chunks
                parity_start = p * chunk_size
                parity_chunk = xor_parities[parity_start:parity_start + chunk_size]

                recovered_chunk = bytearray(parity_chunk)
                for k in range(p, num_chunks, num_parity_chunks):
                    if k == i:
                        continue
                    for j in range(chunk_size):
                        recovered_chunk[j] ^= chunks[k][j]

                chunks[i] = recovered_chunk

            final_data = bytearray()
            for chunk in chunks:
                final_data.extend(chunk)

            return bytes(final_data[:block_size])

        except Exception:
            return None

    def _safe_unpack(self, data: bytes) -> Tuple[int, int, int]:
        """安全解包三元组"""
        import struct
        try:
            return struct.unpack('<III', data)
        except Exception:
            return 0, 64, 0

    def recover_block(self, block_index: int,
                      all_fragments: List[Dict],
                      parity_data: Optional[bytes],
                      expected_hash: str,
                      block_size: int = 4096) -> Tuple[Optional[bytes], str, List[str]]:
        """
        恢复单个块（综合使用三种策略）

        Args:
            block_index: 块索引
            all_fragments: 所有片段
            parity_data: LDPC 校验数据（可选）
            expected_hash: 期望的块哈希
            block_size: 块大小

        Returns:
            (恢复的数据, 恢复方法, 贡献的节点ID列表)
        """
        sources = self.collect_block_sources(block_index, all_fragments)
        contributing_nodes = list(set(s.get("node_id", "unknown") for s in sources))

        if not sources:
            return None, "no_sources", []

        data, success = self.try_direct_recovery(sources, expected_hash)
        if success:
            return data, "direct", contributing_nodes

        data, success = self.try_combining_recovery(sources, expected_hash, block_size)
        if success:
            return data, "combined", contributing_nodes

        if parity_data:
            data, success = self.try_ldpc_recovery(sources, parity_data, expected_hash, block_size)
            if success:
                return data, "ldpc", contributing_nodes

        return None, "failed", contributing_nodes

    def rebuild_image(self, total_blocks: int,
                      all_fragments: List[Dict],
                      parity_map: Dict[int, bytes],
                      expected_hashes: Dict[int, str],
                      block_size: int = 4096) -> Tuple[bytes, Dict]:
        """
        重建完整镜像

        Args:
            total_blocks: 总块数
            all_fragments: 所有收集到的片段
            parity_map: 块索引到校验数据的映射
            expected_hashes: 块索引到期望哈希的映射
            block_size: 块大小

        Returns:
            (重建的镜像数据, 恢复统计信息)
        """
        result = bytearray(total_blocks * block_size)

        stats = {
            "total_blocks": total_blocks,
            "recovered_blocks": [],
            "unrecoverable_blocks": [],
            "recovery_methods": {
                "direct": 0,
                "combined": 0,
                "ldpc": 0,
                "failed": 0
            },
            "node_contributions": defaultdict(int),
            "block_sources": {}
        }

        for block_index in range(total_blocks):
            expected_hash = expected_hashes.get(block_index)
            if not expected_hash:
                stats["unrecoverable_blocks"].append(block_index)
                continue

            parity_data = parity_map.get(block_index)

            recovered_data, method, nodes = self.recover_block(
                block_index, all_fragments, parity_data, expected_hash, block_size
            )

            stats["block_sources"][block_index] = nodes
            for node in nodes:
                stats["node_contributions"][node] += 1

            if recovered_data:
                start = block_index * block_size
                result[start:start + block_size] = recovered_data
                stats["recovered_blocks"].append(block_index)
                stats["recovery_methods"][method] += 1
            else:
                stats["unrecoverable_blocks"].append(block_index)
                stats["recovery_methods"]["failed"] += 1

        stats["node_contributions"] = dict(stats["node_contributions"])
        stats["recovery_rate"] = len(stats["recovered_blocks"]) / total_blocks if total_blocks > 0 else 0

        return bytes(result), stats


import struct
