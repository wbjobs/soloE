import os
import base64
from typing import List, Dict, Tuple, Optional
from collections import defaultdict
from tqdm import tqdm

from ldpc import LDPCEncoder, BlockHasher
from api_client import APIClient
from interleaver import Interleaver
from block_processor import CorruptionDetector


class RecoveryResult:
    """恢复结果封装"""

    def __init__(self):
        self.total_corrupted_blocks: int = 0
        self.recovered_blocks: List[int] = []
        self.unrecoverable_blocks: List[int] = []
        self.failed_blocks: List[int] = []
        self.byte_level_corruption: Dict[int, List[bool]] = {}
        self.use_interleave: bool = False
        self.interleave_analysis: Optional[Dict] = None
        self.group_recovery_stats: Dict[int, Dict] = {}

    @property
    def recovery_rate(self) -> float:
        """恢复成功率"""
        if self.total_corrupted_blocks == 0:
            return 1.0
        return len(self.recovered_blocks) / self.total_corrupted_blocks


class RecoveryProcessor:
    """数据恢复处理器"""

    def __init__(self, api_client: APIClient, redundancy_rate: float = 0.2):
        self.api_client = api_client
        self.encoder = LDPCEncoder(redundancy_rate=redundancy_rate)
        self.interleaver: Optional[Interleaver] = None

    def recover_image(self, image_path: str, image_name: str,
                      output_path: Optional[str] = None,
                      use_async: bool = False) -> RecoveryResult:
        """
        恢复损坏的镜像文件

        Args:
            image_path: 损坏的镜像文件路径
            image_name: 后端存储的镜像名称
            output_path: 恢复后镜像的输出路径（默认覆盖原文件）
            use_async: 是否使用异步恢复

        Returns:
            恢复结果
        """
        result = RecoveryResult()

        if output_path is None:
            output_path = image_path

        image_info = self.api_client.get_image_info(image_name)
        total_blocks = image_info["total_blocks"]
        block_size = image_info["block_size"]
        use_interleave = image_info.get("use_interleave", False)
        result.use_interleave = use_interleave

        if use_interleave and image_info.get("interleave_map"):
            self.interleaver = Interleaver.from_mapping(image_info["interleave_map"])
        else:
            self.interleaver = None

        all_blocks = self.api_client.get_image_blocks(image_name)

        if use_interleave and self.interleaver:
            expected_hashes = {}
            physical_to_logical = {}
            for blk in all_blocks:
                logical_idx = blk.get("logical_index", blk["block_index"])
                physical_idx = blk["block_index"]
                expected_hashes[logical_idx] = blk["block_hash"]
                physical_to_logical[physical_idx] = logical_idx
        else:
            expected_hashes = {blk["block_index"]: blk["block_hash"] for blk in all_blocks}
            physical_to_logical = {blk["block_index"]: blk["block_index"] for blk in all_blocks}

        corrupted_blocks, corruption_maps = CorruptionDetector.detect_corruption(
            image_path, expected_hashes, block_size
        )

        result.total_corrupted_blocks = len(corrupted_blocks)
        result.byte_level_corruption = corruption_maps

        if not corrupted_blocks:
            return result

        if use_interleave and self.interleaver:
            result.interleave_analysis = self.interleaver.analyze_corruption(corrupted_blocks)
            max_corruption_per_group = result.interleave_analysis["max_corruption_per_group"]
            max_recoverable = result.interleave_analysis["max_recoverable_per_group"]

            if not result.interleave_analysis["can_recover"]:
                result.unrecoverable_blocks = corrupted_blocks
                return result

            corrupted_physical_blocks = [
                self.interleaver.logical_to_physical(logical_idx)
                for logical_idx in corrupted_blocks
            ]
        else:
            max_recoverable = int(total_blocks * 0.15)
            if len(corrupted_blocks) > max_recoverable:
                result.unrecoverable_blocks = corrupted_blocks
                return result
            corrupted_physical_blocks = corrupted_blocks

        recovery_data = self.api_client.prepare_recovery(image_name, corrupted_physical_blocks)
        recoverable_physical = set(recovery_data["recoverable_blocks"])
        parity_data = recovery_data["parity_data"]

        import shutil
        shutil.copy2(image_path, output_path)

        if use_interleave and self.interleaver:
            result = self._recover_with_interleave(
                output_path, corrupted_blocks, corruption_maps,
                expected_hashes, parity_data, block_size, recoverable_physical, result
            )
        else:
            result = self._recover_without_interleave(
                output_path, corrupted_blocks, corruption_maps,
                expected_hashes, parity_data, block_size, recoverable_physical, result
            )

        return result

    def _recover_without_interleave(self, output_path: str, corrupted_blocks: List[int],
                                     corruption_maps: Dict[int, List[bool]],
                                     expected_hashes: Dict[int, str],
                                     parity_data: Dict, block_size: int,
                                     recoverable: set, result: RecoveryResult) -> RecoveryResult:
        """非交织模式下的恢复"""
        with open(output_path, 'r+b') as f:
            for block_idx in tqdm(corrupted_blocks, desc="恢复块"):
                if block_idx not in recoverable:
                    result.unrecoverable_blocks.append(block_idx)
                    continue

                f.seek(block_idx * block_size)
                corrupted_data = f.read(block_size)

                parity_b64 = parity_data.get(str(block_idx))
                if not parity_b64:
                    result.unrecoverable_blocks.append(block_idx)
                    continue

                try:
                    parity = base64.b64decode(parity_b64)
                    corruption_map = corruption_maps.get(block_idx, [True] * len(corrupted_data))

                    recovered_data, success = self.encoder.decode(
                        corrupted_data, parity, corruption_map
                    )

                    if success and BlockHasher.verify_hash(recovered_data, expected_hashes[block_idx]):
                        f.seek(block_idx * block_size)
                        f.write(recovered_data)
                        result.recovered_blocks.append(block_idx)
                    else:
                        result.failed_blocks.append(block_idx)

                except Exception as e:
                    result.failed_blocks.append(block_idx)

        return result

    def _recover_with_interleave(self, output_path: str, corrupted_logical_blocks: List[int],
                                 corruption_maps: Dict[int, List[bool]],
                                 expected_hashes: Dict[int, str],
                                 parity_data: Dict, block_size: int,
                                 recoverable_physical: set, result: RecoveryResult) -> RecoveryResult:
        """交织模式下的恢复（按组恢复以提高成功率）"""
        if not self.interleaver:
            return self._recover_without_interleave(
                output_path, corrupted_logical_blocks, corruption_maps,
                expected_hashes, parity_data, block_size, recoverable_physical, result
            )

        group_corrupted = defaultdict(list)
        for logical_idx in corrupted_logical_blocks:
            group_id = self.interleaver.get_group(logical_idx)
            group_corrupted[group_id].append(logical_idx)

        result.group_recovery_stats = {}

        with open(output_path, 'r+b') as f:
            for group_id in tqdm(sorted(group_corrupted.keys()), desc="按组恢复"):
                group_logical_blocks = group_corrupted[group_id]
                group_stats = {"total": len(group_logical_blocks), "recovered": 0, "failed": 0}

                for logical_idx in group_logical_blocks:
                    physical_idx = self.interleaver.logical_to_physical(logical_idx)

                    if physical_idx not in recoverable_physical:
                        result.unrecoverable_blocks.append(logical_idx)
                        continue

                    f.seek(logical_idx * block_size)
                    corrupted_data = f.read(block_size)

                    parity_b64 = parity_data.get(str(physical_idx))
                    if not parity_b64:
                        result.unrecoverable_blocks.append(logical_idx)
                        continue

                    try:
                        parity = base64.b64decode(parity_b64)
                        corruption_map = corruption_maps.get(logical_idx, [True] * len(corrupted_data))

                        recovered_data, success = self.encoder.decode(
                            corrupted_data, parity, corruption_map
                        )

                        if success and BlockHasher.verify_hash(recovered_data, expected_hashes[logical_idx]):
                            f.seek(logical_idx * block_size)
                            f.write(recovered_data)
                            result.recovered_blocks.append(logical_idx)
                            group_stats["recovered"] += 1
                        else:
                            result.failed_blocks.append(logical_idx)
                            group_stats["failed"] += 1

                    except Exception as e:
                        result.failed_blocks.append(logical_idx)
                        group_stats["failed"] += 1

                result.group_recovery_stats[group_id] = group_stats

        return result
