import math
import random
from typing import List, Tuple, Dict, Optional


class Interleaver:
    """
    块交织器 - 将逻辑上连续的块打乱到不同的物理校验组

    工作原理：
    1. 将连续的逻辑块分成多个交织组
    2. 每个交织组内的块被打乱顺序
    3. 物理存储时按打乱后的顺序排列
    4. 这样连续的逻辑损坏会被分散到不同的校验组，提高恢复能力

    交织组大小（group_size）决定了抗连续损坏的能力：
    - group_size = 64: 最多可以抵抗 64 个连续块的损坏
    - 更大的 group_size 提供更强的抗连续损坏能力，但计算开销更大
    """

    def __init__(self, total_blocks: int, group_size: int = 64, seed: Optional[int] = None):
        self.total_blocks = total_blocks
        self.group_size = group_size
        self.seed = seed if seed is not None else 42

        self.num_groups = (total_blocks + group_size - 1) // group_size

        self._logical_to_physical: Dict[int, int] = {}
        self._physical_to_logical: Dict[int, int] = {}
        self._group_membership: Dict[int, int] = {}

        self._generate_mapping()

    def _generate_mapping(self):
        """生成逻辑块到物理块的映射"""
        rng = random.Random(self.seed)

        physical_index = 0
        for group_id in range(self.num_groups):
            group_start = group_id * self.group_size
            group_end = min(group_start + self.group_size, self.total_blocks)
            group_logical_indices = list(range(group_start, group_end))

            rng.shuffle(group_logical_indices)

            for logical_idx in group_logical_indices:
                self._logical_to_physical[logical_idx] = physical_index
                self._physical_to_logical[physical_index] = logical_idx
                self._group_membership[logical_idx] = group_id
                physical_index += 1

    def logical_to_physical(self, logical_index: int) -> int:
        """逻辑块索引 -> 物理块索引"""
        return self._logical_to_physical.get(logical_index, logical_index)

    def physical_to_logical(self, physical_index: int) -> int:
        """物理块索引 -> 逻辑块索引"""
        return self._physical_to_logical.get(physical_index, physical_index)

    def get_group(self, logical_index: int) -> int:
        """获取逻辑块所属的交织组"""
        return self._group_membership.get(logical_index, 0)

    def get_group_members(self, group_id: int) -> List[int]:
        """获取交织组的所有成员（逻辑块索引）"""
        return [
            logical_idx for logical_idx, gid in self._group_membership.items()
            if gid == group_id
        ]

    def interleave_data(self, logical_blocks: List[bytes]) -> List[bytes]:
        """
        对数据块进行交织排序

        Args:
            logical_blocks: 按逻辑顺序排列的数据块列表

        Returns:
            按物理顺序排列的数据块列表
        """
        if len(logical_blocks) != self.total_blocks:
            raise ValueError(
                f"块数量不匹配: 期望 {self.total_blocks}, 实际 {len(logical_blocks)}"
            )

        physical_blocks = [None] * self.total_blocks
        for logical_idx, data in enumerate(logical_blocks):
            physical_idx = self.logical_to_physical(logical_idx)
            physical_blocks[physical_idx] = data

        return physical_blocks

    def deinterleave_data(self, physical_blocks: List[bytes]) -> List[bytes]:
        """
        对数据块进行解交织，恢复逻辑顺序

        Args:
            physical_blocks: 按物理顺序排列的数据块列表

        Returns:
            按逻辑顺序排列的数据块列表
        """
        if len(physical_blocks) != self.total_blocks:
            raise ValueError(
                f"块数量不匹配: 期望 {self.total_blocks}, 实际 {len(physical_blocks)}"
            )

        logical_blocks = [None] * self.total_blocks
        for physical_idx, data in enumerate(physical_blocks):
            logical_idx = self.physical_to_logical(physical_idx)
            logical_blocks[logical_idx] = data

        return logical_blocks

    def get_mapping(self) -> Dict:
        """获取完整的映射关系（用于序列化存储）"""
        return {
            "total_blocks": self.total_blocks,
            "group_size": self.group_size,
            "seed": self.seed,
            "logical_to_physical": {str(k): v for k, v in self._logical_to_physical.items()},
            "physical_to_logical": {str(k): v for k, v in self._physical_to_logical.items()},
            "group_membership": {str(k): v for k, v in self._group_membership.items()}
        }

    @classmethod
    def from_mapping(cls, mapping: Dict) -> 'Interleaver':
        """从序列化的映射关系重建交织器"""
        interleaver = cls.__new__(cls)
        interleaver.total_blocks = mapping["total_blocks"]
        interleaver.group_size = mapping["group_size"]
        interleaver.seed = mapping["seed"]
        interleaver.num_groups = (interleaver.total_blocks + interleaver.group_size - 1) // interleaver.group_size
        interleaver._logical_to_physical = {int(k): v for k, v in mapping["logical_to_physical"].items()}
        interleaver._physical_to_logical = {int(k): v for k, v in mapping["physical_to_logical"].items()}
        interleaver._group_membership = {int(k): v for k, v in mapping["group_membership"].items()}
        return interleaver

    def analyze_corruption(self, corrupted_logical_indices: List[int]) -> Dict:
        """
        分析损坏分布，评估交织效果

        Args:
            corrupted_logical_indices: 损坏的逻辑块索引列表

        Returns:
            分析结果字典
        """
        corrupted_set = set(corrupted_logical_indices)

        group_corruption_counts: Dict[int, int] = {}
        for logical_idx in corrupted_logical_indices:
            group_id = self.get_group(logical_idx)
            group_corruption_counts[group_id] = group_corruption_counts.get(group_id, 0) + 1

        max_group_corruption = max(group_corruption_counts.values()) if group_corruption_counts else 0

        worst_group_id = max(group_corruption_counts, key=group_corruption_counts.get) if group_corruption_counts else -1
        worst_group_size = len(self.get_group_members(worst_group_id)) if worst_group_id >= 0 else 0
        max_recoverable_per_group = int(worst_group_size * 0.15) if worst_group_size > 0 else 0

        can_recover = max_group_corruption <= max_recoverable_per_group if max_recoverable_per_group > 0 else False

        runs = self._find_continuous_runs(corrupted_logical_indices)
        max_run_length = max(runs) if runs else 0

        return {
            "total_corrupted": len(corrupted_logical_indices),
            "num_groups_affected": len(group_corruption_counts),
            "max_corruption_per_group": max_group_corruption,
            "max_recoverable_per_group": max_recoverable_per_group,
            "worst_group_id": worst_group_id,
            "can_recover": can_recover,
            "max_continuous_run": max_run_length,
            "continuous_runs": runs,
            "group_corruption_distribution": {
                str(k): v for k, v in sorted(group_corruption_counts.items())
            }
        }

    def _find_continuous_runs(self, indices: List[int]) -> List[int]:
        """查找连续的索引序列"""
        if not indices:
            return []

        sorted_indices = sorted(indices)
        runs = []
        current_run = 1

        for i in range(1, len(sorted_indices)):
            if sorted_indices[i] == sorted_indices[i - 1] + 1:
                current_run += 1
            else:
                runs.append(current_run)
                current_run = 1

        runs.append(current_run)
        return runs
