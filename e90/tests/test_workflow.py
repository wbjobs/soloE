#!/usr/bin/env python3
"""
测试脚本 v2.0 - 完整的端到端测试流程（包含交织保护测试）
"""
import os
import sys
import tempfile
import shutil
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'cli'))

from api_client import APIClient
from block_processor import BlockProcessor, CorruptionDetector
from recovery import RecoveryProcessor
from report import ReportGenerator
from ldpc import LDPCEncoder, BlockHasher
from interleaver import Interleaver


def create_test_image(size_mb: int = 10) -> str:
    """创建测试用的磁盘镜像文件"""
    test_file = tempfile.mktemp(suffix='.img', prefix='test_')
    size = size_mb * 1024 * 1024

    with open(test_file, 'wb') as f:
        data = os.urandom(size)
        f.write(data)

    print(f"✓ 创建测试镜像: {test_file} ({size_mb} MB)")
    return test_file


def test_ldpc_encoder():
    """测试LDPC编码器"""
    print("\n=== 测试 LDPC 编码器 ===")
    encoder = LDPCEncoder(redundancy_rate=0.2)

    data = os.urandom(4096)
    parity = encoder.encode(data)

    print(f"原始数据大小: {len(data)} 字节")
    print(f"校验数据大小: {len(parity)} 字节")
    print(f"冗余率: {len(parity)/len(data)*100:.1f}%")

    corruption_map = [False] * len(data)
    for i in range(100, 200):
        corruption_map[i] = True

    corrupted = bytearray(data)
    for i in range(100, 200):
        corrupted[i] ^= 0xFF

    recovered, success = encoder.decode(bytes(corrupted), parity, corruption_map)

    if success and recovered == data:
        print("✓ 解码恢复成功")
    else:
        print("✗ 解码恢复失败")

    return success


def test_interleaver():
    """测试交织器"""
    print("\n=== 测试交织器 ===")

    total_blocks = 512
    group_size = 64

    interleaver = Interleaver(total_blocks, group_size)
    print(f"总块数: {total_blocks}, 组大小: {group_size}, 组数: {interleaver.num_groups}")

    logical_indices = list(range(total_blocks))
    shuffled = [interleaver.logical_to_physical(i) for i in logical_indices]

    assert len(set(shuffled)) == total_blocks, "交织映射不是一对一的"
    print("✓ 交织映射是一对一的")

    for i in logical_indices:
        physical = interleaver.logical_to_physical(i)
        logical = interleaver.physical_to_logical(physical)
        assert logical == i, f"交织映射不一致: {i} -> {physical} -> {logical}"
    print("✓ 交织映射可逆")

    continuous_corrupted = list(range(100, 164))
    analysis = interleaver.analyze_corruption(continuous_corrupted)
    print(f"\n连续损坏分析 ({len(continuous_corrupted)} 个连续块):")
    print(f"  影响组数: {analysis['num_groups_affected']}")
    print(f"  单组最大损坏: {analysis['max_corruption_per_group']}")
    print(f"  单组最大可恢复: {analysis['max_recoverable_per_group']}")
    print(f"  可恢复: {analysis['can_recover']}")

    mapping = interleaver.get_mapping()
    restored = Interleaver.from_mapping(mapping)
    assert interleaver.logical_to_physical(42) == restored.logical_to_physical(42)
    print("✓ 交织器序列化/反序列化正常")

    return True


def test_interleaved_recovery():
    """测试交织模式下的连续损坏恢复"""
    print("\n=== 测试交织模式连续损坏恢复 ===")

    api_client = APIClient("http://localhost:8000")
    if not api_client.health_check():
        print("⚠ 后端服务未运行，跳过交织恢复测试")
        return True

    test_image = create_test_image(size_mb=5)
    image_name = f"test_interleave_{int(time.time())}"

    try:
        processor = BlockProcessor(
            block_size=4096,
            redundancy_rate=0.2,
            use_interleave=True,
            interleave_group_size=64
        )
        blocks, total_blocks, interleave_map = processor.process_image(test_image)

        print(f"上传交织保护的镜像 '{image_name}' ...")
        api_client.upload_image(
            image_name=image_name,
            blocks=blocks,
            total_blocks=total_blocks,
            block_size=4096,
            redundancy_rate=0.2,
            use_interleave=True,
            interleave_group_size=64,
            interleave_map=interleave_map
        )
        print("✓ 上传成功")

        corrupted_image = tempfile.mktemp(suffix='.img', prefix='corrupted_')
        corrupted_blocks = CorruptionDetector.simulate_continuous_corruption(
            test_image, corrupted_image,
            start_block=200,
            num_blocks=64
        )
        print(f"模拟连续损坏 {len(corrupted_blocks)} 个块 (200-263)")

        recovery_processor = RecoveryProcessor(api_client, redundancy_rate=0.2)
        recovered_image = tempfile.mktemp(suffix='.img', prefix='recovered_')

        print("开始恢复...")
        result = recovery_processor.recover_image(
            image_path=corrupted_image,
            image_name=image_name,
            output_path=recovered_image
        )

        print(f"\n恢复结果:")
        print(f"  保护模式: {'交织' if result.use_interleave else '常规'}")
        print(f"  总损坏块: {result.total_corrupted_blocks}")
        print(f"  已恢复: {len(result.recovered_blocks)}")
        print(f"  失败: {len(result.failed_blocks)}")
        print(f"  恢复率: {result.recovery_rate * 100:.1f}%")

        if result.interleave_analysis:
            print(f"  交织分析: 单组最大损坏 {result.interleave_analysis['max_corruption_per_group']}")

        report = ReportGenerator.generate_text_report(result, image_name)
        print("\n" + report)

        api_client.delete_image(image_name)
        print("\n✓ 交织恢复测试完成")

        os.unlink(test_image)
        os.unlink(corrupted_image)
        os.unlink(recovered_image)

        return result.recovery_rate > 0.8

    except Exception as e:
        print(f"✗ 测试失败: {e}")
        import traceback
        traceback.print_exc()
        try:
            api_client.delete_image(image_name)
        except:
            pass
        return False


def test_async_upload():
    """测试异步上传"""
    print("\n=== 测试异步上传 ===")

    api_client = APIClient("http://localhost:8000")
    if not api_client.health_check():
        print("⚠ 后端服务未运行，跳过异步上传测试")
        return True

    test_image = create_test_image(size_mb=2)
    image_name = f"test_async_{int(time.time())}"

    try:
        processor = BlockProcessor(block_size=4096, redundancy_rate=0.2)
        blocks, total_blocks, interleave_map = processor.process_image(test_image)

        print(f"异步上传镜像 '{image_name}' ...")
        result = api_client.upload_image(
            image_name=image_name,
            blocks=blocks,
            total_blocks=total_blocks,
            block_size=4096,
            redundancy_rate=0.2,
            use_async=True
        )
        task_id = result["task_id"]
        print(f"✓ 任务已提交: {task_id}")

        print("等待任务完成...")
        result = api_client.wait_for_task(task_id, timeout=60)
        print(f"✓ 任务完成: {result['status']}")

        tasks = api_client.list_tasks()
        print(f"当前任务数: {len(tasks)}")

        api_client.delete_image(image_name)
        os.unlink(test_image)

        return True

    except Exception as e:
        print(f"✗ 测试失败: {e}")
        import traceback
        traceback.print_exc()
        try:
            api_client.delete_image(image_name)
        except:
            pass
        return False


def test_block_hasher():
    """测试块哈希计算器"""
    print("\n=== 测试块哈希计算器 ===")
    data = os.urandom(4096)
    hash_val = BlockHasher.compute_hash(data)

    print(f"数据哈希: {hash_val[:16]}...")
    assert BlockHasher.verify_hash(data, hash_val), "哈希验证失败"
    print("✓ 哈希计算和验证正常")
    return True


def test_block_processor():
    """测试块处理器"""
    print("\n=== 测试块处理器 ===")
    test_image = create_test_image(size_mb=2)

    processor = BlockProcessor(block_size=4096, redundancy_rate=0.2)

    total_blocks = processor.get_total_blocks(test_image)
    print(f"总块数: {total_blocks}")

    blocks, count, interleave_map = processor.process_image(test_image)
    print(f"处理完成，生成 {len(blocks)} 个块的校验数据")

    os.unlink(test_image)
    print("✓ 块处理器正常")
    return True


def test_corruption_simulation():
    """测试损坏模拟"""
    print("\n=== 测试损坏模拟 ===")
    test_image = create_test_image(size_mb=2)
    corrupted_image = tempfile.mktemp(suffix='.img', prefix='corrupted_')

    corrupted_blocks = CorruptionDetector.simulate_corruption(
        test_image, corrupted_image, corruption_rate=0.1
    )

    print(f"随机损坏块数: {len(corrupted_blocks)}")

    continuous_image = tempfile.mktemp(suffix='.img', prefix='continuous_')
    continuous_blocks = CorruptionDetector.simulate_continuous_corruption(
        test_image, continuous_image,
        start_block=100,
        num_blocks=50
    )
    print(f"连续损坏块数: {len(continuous_blocks)} (100-149)")

    os.unlink(test_image)
    os.unlink(corrupted_image)
    os.unlink(continuous_image)
    print("✓ 损坏模拟正常")
    return True


def test_full_workflow():
    """测试完整工作流（需要后端服务运行）"""
    print("\n=== 测试完整工作流 ===")

    api_client = APIClient("http://localhost:8000")
    if not api_client.health_check():
        print("⚠ 后端服务未运行，跳过完整工作流测试")
        return True

    test_image = create_test_image(size_mb=5)
    image_name = f"test_image_{int(time.time())}"

    try:
        processor = BlockProcessor(block_size=4096, redundancy_rate=0.2)
        blocks, total_blocks, _ = processor.process_image(test_image)

        print(f"上传镜像 '{image_name}' 的校验数据...")
        api_client.upload_image(
            image_name=image_name,
            blocks=blocks,
            total_blocks=total_blocks,
            block_size=4096,
            redundancy_rate=0.2
        )
        print("✓ 上传成功")

        corrupted_image = tempfile.mktemp(suffix='.img', prefix='corrupted_')
        corrupted_blocks = CorruptionDetector.simulate_corruption(
            test_image, corrupted_image, corruption_rate=0.1
        )
        print(f"模拟随机损坏 {len(corrupted_blocks)} 个块")

        recovery_processor = RecoveryProcessor(api_client, redundancy_rate=0.2)
        recovered_image = tempfile.mktemp(suffix='.img', prefix='recovered_')

        print("开始恢复...")
        result = recovery_processor.recover_image(
            image_path=corrupted_image,
            image_name=image_name,
            output_path=recovered_image
        )

        print(f"\n恢复结果:")
        print(f"  总损坏块: {result.total_corrupted_blocks}")
        print(f"  已恢复: {len(result.recovered_blocks)}")
        print(f"  失败: {len(result.failed_blocks)}")
        print(f"  恢复率: {result.recovery_rate * 100:.1f}%")

        report = ReportGenerator.generate_text_report(result, image_name)
        print("\n" + report)

        api_client.delete_image(image_name)
        print("\n✓ 测试完成")

        os.unlink(test_image)
        os.unlink(corrupted_image)
        os.unlink(recovered_image)

        return True

    except Exception as e:
        print(f"✗ 测试失败: {e}")
        import traceback
        traceback.print_exc()
        try:
            api_client.delete_image(image_name)
        except:
            pass
        return False


def main():
    """运行所有测试"""
    print("=" * 60)
    print("LDPC 磁盘镜像保护系统 v2.0 - 单元测试")
    print("=" * 60)

    tests = [
        ("LDPC编码器", test_ldpc_encoder),
        ("块哈希计算器", test_block_hasher),
        ("交织器", test_interleaver),
        ("块处理器", test_block_processor),
        ("损坏模拟", test_corruption_simulation),
        ("完整工作流", test_full_workflow),
        ("交织恢复", test_interleaved_recovery),
        ("异步上传", test_async_upload),
    ]

    passed = 0
    failed = 0

    for name, test_func in tests:
        try:
            if test_func():
                passed += 1
            else:
                failed += 1
        except Exception as e:
            print(f"✗ {name} 测试异常: {e}")
            import traceback
            traceback.print_exc()
            failed += 1

    print("\n" + "=" * 60)
    print(f"测试结果: {passed} 通过, {failed} 失败")
    print("=" * 60)

    sys.exit(0 if failed == 0 else 1)


if __name__ == '__main__':
    main()
