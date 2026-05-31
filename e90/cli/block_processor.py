import os
import struct
from typing import Iterator, Tuple, List, Dict, Optional
import hashlib

from ldpc import LDPCEncoder, BlockHasher
from interleaver import Interleaver


class BlockProcessor:
    """磁盘镜像分块处理器"""

    def __init__(self, block_size: int = 4096, redundancy_rate: float = 0.2,
                 use_interleave: bool = False, interleave_group_size: int = 64):
        self.block_size = block_size
        self.redundancy_rate = redundancy_rate
        self.use_interleave = use_interleave
        self.interleave_group_size = interleave_group_size
        self.encoder = LDPCEncoder(redundancy_rate=redundancy_rate)
        self.interleaver: Optional[Interleaver] = None

    def read_blocks(self, image_path: str) -> Iterator[Tuple[int, bytes]]:
        """
        读取磁盘镜像文件，按块迭代

        Args:
            image_path: 磁盘镜像文件路径

        Yields:
            (块索引, 块数据)
        """
        with open(image_path, 'rb') as f:
            block_index = 0
            while True:
                data = f.read(self.block_size)
                if not data:
                    break
                yield block_index, data
                block_index += 1

    def read_all_blocks(self, image_path: str) -> List[bytes]:
        """读取所有块到内存"""
        return [data for _, data in self.read_blocks(image_path)]

    def process_image(self, image_path: str, use_async: bool = False,
                      progress_callback=None) -> Tuple[List[Dict], int, Optional[Dict]]:
        """
        处理整个磁盘镜像，生成所有块的校验数据

        Args:
            image_path: 磁盘镜像文件路径
            use_async: 是否使用异步处理
            progress_callback: 进度回调函数

        Returns:
            (块数据列表, 总块数, 交织映射)
        """
        import base64
        total_blocks = self.get_total_blocks(image_path)

        if self.use_interleave:
            self.interleaver = Interleaver(total_blocks, self.interleave_group_size)
            interleave_map = self.interleaver.get_mapping()
        else:
            interleave_map = None

        blocks = []

        for block_index, data in self.read_blocks(image_path):
            block_hash = BlockHasher.compute_hash(data)
            parity_data = self.encoder.encode(data)

            if self.use_interleave and self.interleaver:
                physical_index = self.interleaver.logical_to_physical(block_index)
                group_id = self.interleaver.get_group(block_index)
            else:
                physical_index = block_index
                group_id = None

            blocks.append({
                "block_index": physical_index,
                "logical_index": block_index,
                "interleave_group": group_id,
                "block_hash": block_hash,
                "parity_data": base64.b64encode(parity_data).decode('utf-8')
            })

            if progress_callback:
                progress_callback(block_index + 1, total_blocks)

        return blocks, total_blocks, interleave_map

    def get_image_size(self, image_path: str) -> int:
        """获取镜像文件大小"""
        return os.path.getsize(image_path)

    def get_total_blocks(self, image_path: str) -> int:
        """获取总块数"""
        size = self.get_image_size(image_path)
        return (size + self.block_size - 1) // self.block_size

    def set_interleaver_from_mapping(self, mapping: Dict):
        """从存储的映射重建交织器"""
        self.interleaver = Interleaver.from_mapping(mapping)
        self.use_interleave = True


class CorruptionDetector:
    """损坏检测工具"""

    @staticmethod
    def detect_corruption(image_path: str, expected_hashes: Dict[int, str],
                          block_size: int = 4096) -> Tuple[List[int], Dict[int, List[bool]]]:
        """
        检测镜像文件中的损坏块

        Args:
            image_path: 镜像文件路径
            expected_hashes: 预期的块哈希映射 {逻辑块索引: 哈希值}
            block_size: 块大小

        Returns:
            (损坏块索引列表, 字节级损坏映射)
        """
        corrupted_blocks = []
        byte_corruption_maps = {}

        with open(image_path, 'rb') as f:
            block_index = 0
            while True:
                data = f.read(block_size)
                if not data:
                    break

                if block_index in expected_hashes:
                    actual_hash = BlockHasher.compute_hash(data)
                    if actual_hash != expected_hashes[block_index]:
                        corrupted_blocks.append(block_index)

                        corruption_map = CorruptionDetector._build_byte_corruption_map(
                            data, block_index, expected_hashes[block_index]
                        )
                        byte_corruption_maps[block_index] = corruption_map

                block_index += 1

        return corrupted_blocks, byte_corruption_maps

    @staticmethod
    def _build_byte_corruption_map(data: bytes, block_index: int,
                                   expected_hash: str) -> List[bool]:
        """构建字节级损坏映射（简化实现，标记整个块为损坏）"""
        return [True] * len(data)

    @staticmethod
    def simulate_corruption(image_path: str, output_path: str,
                            corruption_rate: float = 0.1,
                            block_size: int = 4096,
                            continuous: bool = False,
                            continuous_length: int = 256) -> List[int]:
        """
        模拟镜像损坏（用于测试）

        Args:
            image_path: 原始镜像路径
            output_path: 损坏后镜像输出路径
            corruption_rate: 损坏比例（0-1）
            block_size: 块大小
            continuous: 是否模拟连续损坏
            continuous_length: 连续损坏的块数

        Returns:
            损坏的块索引列表
        """
        import random
        import shutil

        shutil.copy2(image_path, output_path)
        file_size = os.path.getsize(output_path)
        total_blocks = (file_size + block_size - 1) // block_size

        if continuous:
            start_block = random.randint(0, max(0, total_blocks - continuous_length))
            corrupted_blocks = list(range(start_block, start_block + continuous_length))
            corrupted_blocks = [b for b in corrupted_blocks if b < total_blocks]
        else:
            num_corrupted = max(1, int(total_blocks * corruption_rate))
            corrupted_blocks = random.sample(range(total_blocks), num_corrupted)

        with open(output_path, 'r+b') as f:
            for block_idx in corrupted_blocks:
                f.seek(block_idx * block_size)
                data = f.read(block_size)
                if data:
                    corrupted_data = bytearray(data)
                    num_bytes_to_corrupt = max(1, int(len(data) * 0.1))
                    positions = random.sample(range(len(data)), num_bytes_to_corrupt)
                    for pos in positions:
                        corrupted_data[pos] ^= 0xFF
                    f.seek(block_idx * block_size)
                    f.write(bytes(corrupted_data))

        return sorted(corrupted_blocks)

    @staticmethod
    def simulate_continuous_corruption(image_path: str, output_path: str,
                                       start_block: int, num_blocks: int,
                                       block_size: int = 4096) -> List[int]:
        """
        模拟连续块损坏（坏扇区场景）

        Args:
            image_path: 原始镜像路径
            output_path: 损坏后镜像输出路径
            start_block: 起始损坏块
            num_blocks: 损坏块数量
            block_size: 块大小

        Returns:
            损坏的块索引列表
        """
        import shutil

        shutil.copy2(image_path, output_path)
        file_size = os.path.getsize(output_path)
        total_blocks = (file_size + block_size - 1) // block_size

        corrupted_blocks = list(range(start_block, min(start_block + num_blocks, total_blocks)))

        import random
        with open(output_path, 'r+b') as f:
            for block_idx in corrupted_blocks:
                f.seek(block_idx * block_size)
                data = f.read(block_size)
                if data:
                    corrupted_data = bytearray(data)
                    num_bytes_to_corrupt = max(1, int(len(data) * 0.1))
                    positions = random.sample(range(len(data)), num_bytes_to_corrupt)
                    for pos in positions:
                        corrupted_data[pos] ^= 0xFF
                    f.seek(block_idx * block_size)
                    f.write(bytes(corrupted_data))

        return corrupted_blocks
