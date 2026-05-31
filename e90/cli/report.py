import json
from typing import Dict, List
from recovery import RecoveryResult


class ReportGenerator:
    """报告生成器"""

    @staticmethod
    def generate_text_report(result: RecoveryResult, image_name: str) -> str:
        """生成文本格式的恢复报告"""
        lines = []
        lines.append("=" * 60)
        lines.append("LDPC 镜像恢复报告")
        lines.append("=" * 60)
        lines.append(f"镜像名称: {image_name}")
        lines.append(f"保护模式: {'交织保护' if result.use_interleave else '常规保护'}")
        lines.append(f"总损坏块数: {result.total_corrupted_blocks}")
        lines.append(f"成功恢复: {len(result.recovered_blocks)} 块")
        lines.append(f"恢复失败: {len(result.failed_blocks)} 块")
        lines.append(f"不可恢复: {len(result.unrecoverable_blocks)} 块")
        lines.append(f"恢复成功率: {result.recovery_rate * 100:.2f}%")
        lines.append("")

        if result.interleave_analysis:
            lines.append("交织分析:")
            analysis = result.interleave_analysis
            lines.append(f"  交织组数: {analysis['num_groups_affected']}")
            lines.append(f"  最大连续损坏: {analysis['max_continuous_run']} 块")
            lines.append(f"  单组最大损坏: {analysis['max_corruption_per_group']} 块")
            lines.append(f"  单组最大可恢复: {analysis['max_recoverable_per_group']} 块")
            lines.append(f"  可恢复性: {'是' if analysis['can_recover'] else '否'}")
            lines.append("")

            if result.group_recovery_stats:
                lines.append("各组恢复统计:")
                for group_id, stats in sorted(result.group_recovery_stats.items()):
                    lines.append(f"  组 {group_id}: {stats['recovered']}/{stats['total']} 恢复")
                lines.append("")

        if result.recovered_blocks:
            lines.append("已恢复的块:")
            lines.append(f"  {ReportGenerator._format_block_list(result.recovered_blocks)}")
            lines.append("")

        if result.failed_blocks:
            lines.append("恢复失败的块:")
            lines.append(f"  {ReportGenerator._format_block_list(result.failed_blocks)}")
            lines.append("")

        if result.unrecoverable_blocks:
            lines.append("不可恢复的块:")
            lines.append(f"  {ReportGenerator._format_block_list(result.unrecoverable_blocks)}")
            lines.append("")

        lines.append(ReportGenerator._generate_corruption_map(result))

        return "\n".join(lines)

    @staticmethod
    def generate_json_report(result: RecoveryResult, image_name: str) -> str:
        """生成JSON格式的恢复报告"""
        report = {
            "image_name": image_name,
            "use_interleave": result.use_interleave,
            "summary": {
                "total_corrupted": result.total_corrupted_blocks,
                "recovered": len(result.recovered_blocks),
                "failed": len(result.failed_blocks),
                "unrecoverable": len(result.unrecoverable_blocks),
                "recovery_rate": result.recovery_rate
            },
            "details": {
                "recovered_blocks": result.recovered_blocks,
                "failed_blocks": result.failed_blocks,
                "unrecoverable_blocks": result.unrecoverable_blocks
            },
            "corruption_map": ReportGenerator._build_corruption_map_dict(result)
        }

        if result.interleave_analysis:
            report["interleave_analysis"] = result.interleave_analysis

        if result.group_recovery_stats:
            report["group_recovery_stats"] = {
                str(k): v for k, v in result.group_recovery_stats.items()
            }

        return json.dumps(report, indent=2, ensure_ascii=False)

    @staticmethod
    def _format_block_list(blocks: List[int]) -> str:
        """格式化块列表显示"""
        if not blocks:
            return "无"

        ranges = []
        start = blocks[0]
        prev = blocks[0]

        for block in blocks[1:]:
            if block == prev + 1:
                prev = block
            else:
                if start == prev:
                    ranges.append(str(start))
                else:
                    ranges.append(f"{start}-{prev}")
                start = block
                prev = block

        if start == prev:
            ranges.append(str(start))
        else:
            ranges.append(f"{start}-{prev}")

        return ", ".join(ranges)

    @staticmethod
    def _generate_corruption_map(result: RecoveryResult) -> str:
        """生成块损坏映射图（ASCII可视化）"""
        lines = []
        lines.append("块损坏映射图:")
        lines.append("  ■ = 已恢复  □ = 恢复失败  × = 不可恢复  · = 完好")

        all_blocks = sorted(
            set(result.recovered_blocks) |
            set(result.failed_blocks) |
            set(result.unrecoverable_blocks)
        )

        if not all_blocks:
            lines.append("  无损坏块")
            return "\n".join(lines)

        max_block = max(all_blocks)
        recovered_set = set(result.recovered_blocks)
        failed_set = set(result.failed_blocks)
        unrecoverable_set = set(result.unrecoverable_blocks)

        map_line = []
        for i in range(max_block + 1):
            if i in recovered_set:
                map_line.append("■")
            elif i in failed_set:
                map_line.append("□")
            elif i in unrecoverable_set:
                map_line.append("×")
            else:
                map_line.append("·")

        lines.append("  " + "".join(map_line))
        lines.append(f"  共 {max_block + 1} 块，损坏 {result.total_corrupted_blocks} 块")

        return "\n".join(lines)

    @staticmethod
    def _build_corruption_map_dict(result: RecoveryResult) -> Dict:
        """构建JSON格式的损坏映射"""
        recovered_set = set(result.recovered_blocks)
        failed_set = set(result.failed_blocks)
        unrecoverable_set = set(result.unrecoverable_blocks)

        all_blocks = sorted(recovered_set | failed_set | unrecoverable_set)
        if not all_blocks:
            return {}

        corruption_map = {}
        for block_idx in all_blocks:
            if block_idx in recovered_set:
                status = "recovered"
            elif block_idx in failed_set:
                status = "failed"
            else:
                status = "unrecoverable"
            corruption_map[str(block_idx)] = status

        return corruption_map
