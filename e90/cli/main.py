#!/usr/bin/env python3
import os
import sys
import click
import base64
from tqdm import tqdm

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from api_client import APIClient
from block_processor import BlockProcessor, CorruptionDetector
from recovery import RecoveryProcessor
from report import ReportGenerator


@click.group()
@click.option('--api-url', default='http://localhost:8000',
              help='后端API服务地址', show_default=True)
@click.option('--block-size', default=4096,
              help='块大小（字节）', show_default=True)
@click.option('--redundancy', default=0.2,
              help='冗余度（0-1）', show_default=True)
@click.pass_context
def cli(ctx, api_url, block_size, redundancy):
    """LDPC 磁盘镜像保护工具 v3.0 - 支持交织保护、异步处理和分布式重建"""
    ctx.ensure_object(dict)
    ctx.obj['api_url'] = api_url
    ctx.obj['block_size'] = block_size
    ctx.obj['redundancy'] = redundancy
    ctx.obj['api_client'] = APIClient(api_url)


@cli.command()
@click.argument('image_path', type=click.Path(exists=True, dir_okay=False))
@click.option('--name', 'image_name', required=True,
              help='镜像名称（用于后端存储标识）')
@click.option('--interleave/--no-interleave', default=False,
              help='启用交织保护（抗连续损坏）', show_default=True)
@click.option('--interleave-group-size', default=64,
              help='交织组大小（抗连续损坏能力）', show_default=True)
@click.option('--async', 'use_async', is_flag=True, default=False,
              help='使用异步上传（适合大镜像）')
@click.pass_context
def protect(ctx, image_path, image_name, interleave, interleave_group_size, use_async):
    """保护磁盘镜像 - 生成校验数据并上传到后端"""
    api_client = ctx.obj['api_client']
    block_size = ctx.obj['block_size']
    redundancy = ctx.obj['redundancy']

    click.echo(f"正在处理镜像: {image_path}")
    click.echo(f"块大小: {block_size} 字节")
    click.echo(f"冗余度: {redundancy * 100:.0f}%")
    if interleave:
        click.echo(f"交织保护: 已启用 (组大小: {interleave_group_size})")
    if use_async:
        click.echo("上传模式: 异步")

    if not api_client.health_check():
        click.echo(click.style("错误: 无法连接到后端服务", fg='red'))
        sys.exit(1)

    processor = BlockProcessor(
        block_size=block_size,
        redundancy_rate=redundancy,
        use_interleave=interleave,
        interleave_group_size=interleave_group_size
    )
    total_blocks = processor.get_total_blocks(image_path)
    file_size = processor.get_image_size(image_path)

    click.echo(f"镜像大小: {file_size / (1024*1024):.2f} MB")
    click.echo(f"总块数: {total_blocks}")

    blocks = []
    with click.progressbar(length=total_blocks, label='生成校验数据') as bar:
        for block_index, data in processor.read_blocks(image_path):
            from ldpc import BlockHasher
            block_hash = BlockHasher.compute_hash(data)
            parity_data = processor.encoder.encode(data)

            if interleave and processor.interleaver:
                physical_index = processor.interleaver.logical_to_physical(block_index)
                group_id = processor.interleaver.get_group(block_index)
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
            bar.update(1)

    interleave_map = processor.interleaver.get_mapping() if interleave and processor.interleaver else None

    click.echo("正在上传校验数据到后端...")
    try:
        if use_async:
            result = api_client.upload_image(
                image_name=image_name,
                blocks=blocks,
                total_blocks=total_blocks,
                block_size=block_size,
                redundancy_rate=redundancy,
                use_interleave=interleave,
                interleave_group_size=interleave_group_size,
                interleave_map=interleave_map,
                use_async=True
            )
            task_id = result["task_id"]
            click.echo(f"任务已提交，任务ID: {task_id}")
            click.echo("正在等待任务完成...")

            with click.progressbar(length=100, label='上传进度') as bar:
                def progress_cb(current, total):
                    percent = int((current / total) * 100) if total > 0 else 0
                    bar.update(percent - bar.pos)

                result = api_client.wait_for_task(task_id, progress_callback=progress_cb)
                bar.update(100 - bar.pos)

            click.echo(click.style(f"✓ 镜像 '{image_name}' 保护成功！", fg='green'))
            click.echo(f"  任务ID: {task_id}")
        else:
            result = api_client.upload_image(
                image_name=image_name,
                blocks=blocks,
                total_blocks=total_blocks,
                block_size=block_size,
                redundancy_rate=redundancy,
                use_interleave=interleave,
                interleave_group_size=interleave_group_size,
                interleave_map=interleave_map,
                use_async=False
            )
            click.echo(click.style(f"✓ 镜像 '{image_name}' 保护成功！", fg='green'))
            click.echo(f"  ID: {result['id']}")
            click.echo(f"  创建时间: {result['created_at']}")
    except Exception as e:
        click.echo(click.style(f"✗ 上传失败: {e}", fg='red'))
        sys.exit(1)


@cli.command('recover')
@click.argument('image_path', type=click.Path(exists=True, dir_okay=False))
@click.option('--name', 'image_name', required=True,
              help='后端存储的镜像名称')
@click.option('--output', 'output_path', default=None,
              help='恢复后镜像的输出路径（默认覆盖原文件）')
@click.option('--format', 'report_format', default='text',
              type=click.Choice(['text', 'json']),
              help='报告格式', show_default=True)
@click.option('--report', 'report_path', default=None,
              help='报告输出文件路径')
@click.pass_context
def recover(ctx, image_path, image_name, output_path, report_format, report_path):
    """恢复损坏的磁盘镜像"""
    api_client = ctx.obj['api_client']
    redundancy = ctx.obj['redundancy']

    click.echo(f"正在恢复镜像: {image_path}")
    click.echo(f"镜像名称: {image_name}")

    if not api_client.health_check():
        click.echo(click.style("错误: 无法连接到后端服务", fg='red'))
        sys.exit(1)

    recovery_processor = RecoveryProcessor(api_client, redundancy_rate=redundancy)

    click.echo("正在检测损坏并恢复...")
    try:
        result = recovery_processor.recover_image(
            image_path=image_path,
            image_name=image_name,
            output_path=output_path
        )
    except Exception as e:
        click.echo(click.style(f"✗ 恢复过程出错: {e}", fg='red'))
        sys.exit(1)

    if output_path:
        click.echo(f"恢复后的镜像已保存到: {output_path}")
    else:
        click.echo(f"原镜像已被恢复后的版本覆盖")

    if report_format == 'text':
        report = ReportGenerator.generate_text_report(result, image_name)
    else:
        report = ReportGenerator.generate_json_report(result, image_name)

    click.echo("\n" + report)

    if report_path:
        with open(report_path, 'w', encoding='utf-8') as f:
            f.write(report)
        click.echo(f"\n报告已保存到: {report_path}")

    if result.recovery_rate >= 0.9:
        click.echo(click.style("\n✓ 恢复完成，恢复成功率高", fg='green'))
    elif result.recovery_rate > 0:
        click.echo(click.style(f"\n⚠ 部分恢复成功，成功率: {result.recovery_rate * 100:.1f}%", fg='yellow'))
    else:
        click.echo(click.style("\n✗ 恢复失败", fg='red'))
        sys.exit(2)


@cli.command('verify')
@click.argument('image_path', type=click.Path(exists=True, dir_okay=False))
@click.option('--name', 'image_name', required=True,
              help='后端存储的镜像名称')
@click.pass_context
def verify(ctx, image_path, image_name):
    """验证镜像完整性"""
    api_client = ctx.obj['api_client']
    block_size = ctx.obj['block_size']

    click.echo(f"正在验证镜像: {image_path}")

    if not api_client.health_check():
        click.echo(click.style("错误: 无法连接到后端服务", fg='red'))
        sys.exit(1)

    try:
        image_info = api_client.get_image_info(image_name)
        blocks = api_client.get_image_blocks(image_name)
    except Exception as e:
        click.echo(click.style(f"✗ 获取镜像信息失败: {e}", fg='red'))
        sys.exit(1)

    use_interleave = image_info.get("use_interleave", False)
    if use_interleave:
        click.echo("保护模式: 交织保护")
        expected_hashes = {}
        for blk in blocks:
            logical_idx = blk.get("logical_index", blk["block_index"])
            expected_hashes[logical_idx] = blk["block_hash"]
    else:
        click.echo("保护模式: 常规保护")
        expected_hashes = {blk["block_index"]: blk["block_hash"] for blk in blocks}

    corrupted_blocks = []
    total_blocks = image_info["total_blocks"]

    with click.progressbar(length=total_blocks, label='验证块') as bar:
        with open(image_path, 'rb') as f:
            for block_index in range(total_blocks):
                data = f.read(block_size)
                if not data:
                    break

                from ldpc import BlockHasher
                actual_hash = BlockHasher.compute_hash(data)
                expected_hash = expected_hashes.get(block_index)

                if expected_hash and actual_hash != expected_hash:
                    corrupted_blocks.append(block_index)

                bar.update(1)

    if corrupted_blocks:
        click.echo(click.style(f"✗ 发现 {len(corrupted_blocks)} 个损坏块", fg='red'))
        click.echo(f"  损坏块索引: {corrupted_blocks[:20]}", nl=False)
        if len(corrupted_blocks) > 20:
            click.echo(f" ... (共 {len(corrupted_blocks)} 个)")
        else:
            click.echo()

        if use_interleave and image_info.get("interleave_map"):
            from interleaver import Interleaver
            interleaver = Interleaver.from_mapping(image_info["interleave_map"])
            analysis = interleaver.analyze_corruption(corrupted_blocks)
            click.echo(f"\n交织分析:")
            click.echo(f"  交织组数: {analysis['num_groups_affected']}")
            click.echo(f"  最大连续损坏: {analysis['max_continuous_run']} 块")
            click.echo(f"  单组最大损坏: {analysis['max_corruption_per_group']} 块")
            click.echo(f"  单组最大可恢复: {analysis['max_recoverable_per_group']} 块")
            click.echo(f"  可恢复性: {'是' if analysis['can_recover'] else '否'}")

            if analysis['can_recover']:
                click.echo(click.style("  可恢复（交织保护生效）", fg='green'))
            else:
                click.echo(click.style("  超出恢复能力", fg='red'))
        else:
            max_recoverable = int(total_blocks * 0.15)
            if len(corrupted_blocks) <= max_recoverable:
                click.echo(click.style(f"  可恢复（损坏率 {len(corrupted_blocks)/total_blocks*100:.1f}% ≤ 15%）", fg='yellow'))
            else:
                click.echo(click.style(f"  超出恢复能力（损坏率 {len(corrupted_blocks)/total_blocks*100:.1f}% > 15%）", fg='red'))
        sys.exit(1)
    else:
        click.echo(click.style("✓ 镜像完整性验证通过，无损坏块", fg='green'))


@cli.command('list')
@click.pass_context
def list_images(ctx):
    """列出所有已保护的镜像"""
    api_client = ctx.obj['api_client']

    if not api_client.health_check():
        click.echo(click.style("错误: 无法连接到后端服务", fg='red'))
        sys.exit(1)

    try:
        images = api_client.list_images()
    except Exception as e:
        click.echo(click.style(f"✗ 获取镜像列表失败: {e}", fg='red'))
        sys.exit(1)

    if not images:
        click.echo("暂无已保护的镜像")
        return

    click.echo(f"共找到 {len(images)} 个镜像:")
    click.echo("-" * 100)
    click.echo(f"{'ID':<6} {'名称':<25} {'块数':<10} {'冗余度':<10} {'模式':<10} {'创建时间':<25}")
    click.echo("-" * 100)
    for img in images:
        mode = "交织" if img.get("use_interleave", False) else "常规"
        click.echo(f"{img['id']:<6} {img['name']:<25} {img['total_blocks']:<10} "
                   f"{img['redundancy_rate']*100:<9.0f}% {mode:<10} {img['created_at']:<25}")


@cli.command('tasks')
@click.option('--name', 'image_name', default=None,
              help='按镜像名称过滤')
@click.option('--status', default=None,
              type=click.Choice(['pending', 'running', 'completed', 'failed']),
              help='按状态过滤')
@click.pass_context
def list_tasks(ctx, image_name, status):
    """列出异步任务"""
    api_client = ctx.obj['api_client']

    if not api_client.health_check():
        click.echo(click.style("错误: 无法连接到后端服务", fg='red'))
        sys.exit(1)

    try:
        tasks = api_client.list_tasks(image_name=image_name, status=status)
    except Exception as e:
        click.echo(click.style(f"✗ 获取任务列表失败: {e}", fg='red'))
        sys.exit(1)

    if not tasks:
        click.echo("暂无任务")
        return

    click.echo(f"共找到 {len(tasks)} 个任务:")
    click.echo("-" * 80)
    click.echo(f"{'任务ID':<38} {'类型':<12} {'状态':<10} {'进度':<10} {'镜像':<20}")
    click.echo("-" * 80)
    for task in tasks:
        progress = f"{task['progress']}/{task['total']}" if task['total'] > 0 else "-"
        click.echo(f"{task['task_id']:<38} {task['task_type']:<12} {task['status']:<10} "
                   f"{progress:<10} {task['image_name']:<20}")


@cli.command('task-status')
@click.argument('task_id')
@click.pass_context
def task_status(ctx, task_id):
    """查看异步任务状态"""
    api_client = ctx.obj['api_client']

    if not api_client.health_check():
        click.echo(click.style("错误: 无法连接到后端服务", fg='red'))
        sys.exit(1)

    try:
        status = api_client.get_task_status(task_id)
    except Exception as e:
        click.echo(click.style(f"✗ 获取任务状态失败: {e}", fg='red'))
        sys.exit(1)

    click.echo(f"任务ID: {status['task_id']}")
    click.echo(f"任务类型: {status['task_type']}")
    click.echo(f"状态: {status['status']}")
    click.echo(f"镜像: {status['image_name']}")
    if status['total'] > 0:
        click.echo(f"进度: {status['progress']}/{status['total']} ({status['progress']/status['total']*100:.1f}%)")
    click.echo(f"创建时间: {status['created_at']}")
    click.echo(f"更新时间: {status['updated_at']}")
    if status.get('error'):
        click.echo(click.style(f"错误: {status['error']}", fg='red'))
    if status.get('result'):
        click.echo(f"结果: {status['result']}")


@cli.command()
@click.option('--name', 'image_name', required=True,
              help='要删除的镜像名称')
@click.confirmation_option(prompt='确定要删除此镜像及其所有校验数据吗？')
@click.pass_context
def delete(ctx, image_name):
    """删除镜像及其校验数据"""
    api_client = ctx.obj['api_client']

    if not api_client.health_check():
        click.echo(click.style("错误: 无法连接到后端服务", fg='red'))
        sys.exit(1)

    try:
        api_client.delete_image(image_name)
        click.echo(click.style(f"✓ 镜像 '{image_name}' 已删除", fg='green'))
    except Exception as e:
        click.echo(click.style(f"✗ 删除失败: {e}", fg='red'))
        sys.exit(1)


@cli.command('simulate')
@click.argument('image_path', type=click.Path(exists=True, dir_okay=False))
@click.argument('output_path', type=click.Path(dir_okay=False))
@click.option('--rate', default=0.1,
              help='损坏比例（0-1）', show_default=True)
@click.option('--continuous', is_flag=True, default=False,
              help='模拟连续损坏（坏扇区场景）')
@click.option('--continuous-length', default=256,
              help='连续损坏的块数（默认256块 = 1MB）', show_default=True)
def simulate_corruption(image_path, output_path, rate, continuous, continuous_length):
    """模拟镜像损坏（用于测试）"""
    click.echo(f"正在模拟损坏: {image_path} -> {output_path}")
    if continuous:
        click.echo(f"模式: 连续损坏 ({continuous_length} 块)")
    else:
        click.echo(f"模式: 随机损坏 (比例: {rate * 100:.0f}%)")

    if continuous:
        corrupted = CorruptionDetector.simulate_corruption(
            image_path, output_path,
            corruption_rate=rate,
            continuous=True,
            continuous_length=continuous_length
        )
    else:
        corrupted = CorruptionDetector.simulate_corruption(
            image_path, output_path, corruption_rate=rate
        )

    click.echo(click.style(f"✓ 已生成 {len(corrupted)} 个损坏块", fg='yellow'))
    click.echo(f"损坏块索引: {corrupted[:20]}", nl=False)
    if len(corrupted) > 20:
        click.echo(f" ... (共 {len(corrupted)} 个)")
    else:
        click.echo()


import uuid


def generate_node_id() -> str:
    """生成节点ID"""
    return str(uuid.uuid4())


@cli.group()
def rebuild():
    """分布式镜像重建命令"""
    pass


@rebuild.command('create')
@click.option('--image-name', required=True,
              help='原始镜像名称')
@click.option('--name', 'task_name', required=True,
              help='重建任务名称')
@click.pass_context
def rebuild_create(ctx, image_name, task_name):
    """创建分布式镜像重建任务"""
    api_client = ctx.obj['api_client']

    if not api_client.health_check():
        click.echo(click.style("错误: 无法连接到后端服务", fg='red'))
        sys.exit(1)

    try:
        result = api_client.create_rebuild_task(image_name, task_name)
        click.echo(click.style(f"✓ 重建任务已创建", fg='green'))
        click.echo(f"  任务ID: {result['task_id']}")
        click.echo(f"  任务名称: {result['name']}")
        click.echo(f"  总块数: {result['total_blocks']}")
        click.echo(f"\n请使用以下命令上传片段:")
        click.echo(f"  ldpc-cli rebuild upload-fragments --task-id {result['task_id']} --image <损坏镜像路径>")
    except Exception as e:
        click.echo(click.style(f"✗ 创建失败: {e}", fg='red'))
        sys.exit(1)


@rebuild.command('upload-fragments')
@click.option('--task-id', 'task_id', required=True,
              help='重建任务ID')
@click.option('--image', 'image_path', required=True,
              type=click.Path(exists=True, dir_okay=False),
              help='损坏的镜像文件路径')
@click.option('--node-id', default=None,
              help='节点ID（不指定则自动生成）')
@click.option('--node-name', default=None,
              help='节点名称（便于识别）')
@click.option('--batch-size', default=100,
              help='批量上传大小', show_default=True)
@click.pass_context
def upload_fragments(ctx, task_id, image_path, node_id, node_name, batch_size):
    """上传损坏镜像的片段到重建任务"""
    api_client = ctx.obj['api_client']
    block_size = ctx.obj['block_size']

    if not api_client.health_check():
        click.echo(click.style("错误: 无法连接到后端服务", fg='red'))
        sys.exit(1)

    if node_id is None:
        node_id = generate_node_id()
        click.echo(f"自动生成节点ID: {node_id}")

    try:
        task_status = api_client.get_rebuild_status(task_id)
    except Exception as e:
        click.echo(click.style(f"✗ 获取任务状态失败: {e}", fg='red'))
        sys.exit(1)

    total_blocks = task_status['total_blocks']
    image_info = api_client.get_image_info(task_status['image_name'])
    expected_blocks = api_client.get_image_blocks(task_status['image_name'])
    expected_hashes = {blk["block_index"]: blk["block_hash"] for blk in expected_blocks}

    click.echo(f"任务: {task_status['name']} ({task_id})")
    click.echo(f"节点: {node_name or '未命名'} ({node_id})")
    click.echo(f"镜像: {image_path}")
    click.echo(f"总块数: {total_blocks}")
    click.echo(f"块大小: {block_size} 字节")

    from ldpc import BlockHasher

    valid_blocks = []
    corrupted_blocks = []

    with click.progressbar(length=total_blocks, label='扫描镜像块') as bar:
        with open(image_path, 'rb') as f:
            for block_index in range(total_blocks):
                data = f.read(block_size)
                if not data:
                    break

                if block_index in expected_hashes:
                    actual_hash = BlockHasher.compute_hash(data)
                    if actual_hash == expected_hashes[block_index]:
                        valid_blocks.append({
                            "block_index": block_index,
                            "block_data": data,
                            "block_hash": actual_hash
                        })
                    else:
                        corrupted_blocks.append(block_index)

                bar.update(1)

    click.echo(f"\n扫描完成:")
    click.echo(f"  有效块: {len(valid_blocks)}")
    click.echo(f"  损坏块: {len(corrupted_blocks)}")

    if not valid_blocks:
        click.echo(click.style("⚠ 没有找到有效块，无法上传", fg='yellow'))
        return

    click.echo(f"\n开始上传有效块 (批量大小: {batch_size})...")

    uploaded = 0
    failed = 0

    with click.progressbar(length=len(valid_blocks), label='上传片段') as bar:
        for i in range(0, len(valid_blocks), batch_size):
            batch = valid_blocks[i:i + batch_size]
            try:
                result = api_client.upload_fragment_batch(task_id, node_id, batch, node_name)
                uploaded += len(batch)
            except Exception as e:
                failed += len(batch)
                click.echo(click.style(f"\n批量上传失败 (块 {i}-{i+len(batch)-1}): {e}", fg='red'))
            bar.update(len(batch))

    click.echo(f"\n上传完成:")
    click.echo(f"  成功上传: {uploaded}")
    click.echo(f"  失败: {failed}")

    updated_status = api_client.get_rebuild_status(task_id)
    click.echo(f"\n当前收集进度: {updated_status['collected_count']}/{updated_status['total_blocks']} "
               f"({updated_status['progress']}%)")


@rebuild.command('status')
@click.argument('task_id')
@click.pass_context
def rebuild_status(ctx, task_id):
    """查看重建任务状态"""
    api_client = ctx.obj['api_client']

    if not api_client.health_check():
        click.echo(click.style("错误: 无法连接到后端服务", fg='red'))
        sys.exit(1)

    try:
        status = api_client.get_rebuild_status(task_id)
    except Exception as e:
        click.echo(click.style(f"✗ 获取状态失败: {e}", fg='red'))
        sys.exit(1)

    click.echo(f"任务ID: {status['task_id']}")
    click.echo(f"任务名称: {status['name']}")
    click.echo(f"镜像: {status['image_name']}")
    click.echo(f"状态: {status['status']}")
    click.echo(f"总块数: {status['total_blocks']}")
    click.echo(f"已收集: {status['collected_count']} 块 ({status['progress']}%)")
    click.echo(f"已恢复: {status['recovered_count']} 块")
    click.echo(f"不可恢复: {status['unrecoverable_count']} 块")
    click.echo(f"创建时间: {status['created_at']}")
    click.echo(f"更新时间: {status['updated_at']}")

    if status['node_contributions']:
        click.echo(f"\n节点贡献:")
        for node_id, info in sorted(status['node_contributions'].items(),
                                    key=lambda x: x[1]['count'], reverse=True):
            name = info.get('name') or node_id[:8]
            click.echo(f"  {name}: {info['count']} 块 (唯一: {info['unique']})")


@rebuild.command('list')
@click.option('--image-name', default=None,
              help='按镜像名称过滤')
@click.option('--status', default=None,
              type=click.Choice(['collecting', 'recovering', 'completed', 'failed']),
              help='按状态过滤')
@click.pass_context
def rebuild_list(ctx, image_name, status):
    """列出所有重建任务"""
    api_client = ctx.obj['api_client']

    if not api_client.health_check():
        click.echo(click.style("错误: 无法连接到后端服务", fg='red'))
        sys.exit(1)

    try:
        tasks = api_client.list_rebuild_tasks(image_name=image_name, status=status)
    except Exception as e:
        click.echo(click.style(f"✗ 获取任务列表失败: {e}", fg='red'))
        sys.exit(1)

    if not tasks:
        click.echo("暂无重建任务")
        return

    click.echo(f"共找到 {len(tasks)} 个任务:")
    click.echo("-" * 100)
    click.echo(f"{'任务ID':<38} {'名称':<20} {'状态':<12} {'进度':<12} {'镜像':<20}")
    click.echo("-" * 100)
    for task in tasks:
        progress = f"{task['collected_count']}/{task['total_blocks']}"
        click.echo(f"{task['task_id']:<38} {task['name']:<20} {task['status']:<12} "
                   f"{progress:<12} {task['image_name']:<20}")


@rebuild.command('start')
@click.argument('task_id')
@click.pass_context
def rebuild_start(ctx, task_id):
    """开始执行联合解码重建"""
    api_client = ctx.obj['api_client']

    if not api_client.health_check():
        click.echo(click.style("错误: 无法连接到后端服务", fg='red'))
        sys.exit(1)

    try:
        result = api_client.start_rebuild(task_id)
        click.echo(click.style(f"✓ 重建任务已启动", fg='green'))
        click.echo(f"  任务ID: {result['task_id']}")
        click.echo(f"  状态: {result['status']}")
        click.echo(f"  消息: {result['message']}")
    except Exception as e:
        click.echo(click.style(f"✗ 启动失败: {e}", fg='red'))
        sys.exit(1)


@rebuild.command('download')
@click.argument('task_id')
@click.option('--output', 'output_path', required=True,
              type=click.Path(dir_okay=False),
              help='输出文件路径')
@click.pass_context
def rebuild_download(ctx, task_id, output_path):
    """下载重建完成的镜像"""
    api_client = ctx.obj['api_client']

    if not api_client.health_check():
        click.echo(click.style("错误: 无法连接到后端服务", fg='red'))
        sys.exit(1)

    try:
        status = api_client.get_rebuild_status(task_id)
        if status['status'] != 'completed':
            click.echo(click.style(f"错误: 任务尚未完成，当前状态: {status['status']}", fg='red'))
            sys.exit(1)
    except Exception as e:
        click.echo(click.style(f"✗ 获取任务状态失败: {e}", fg='red'))
        sys.exit(1)

    click.echo(f"正在下载重建的镜像到: {output_path}")

    try:
        api_client.download_rebuilt_image(task_id, output_path)
        file_size = os.path.getsize(output_path)
        click.echo(click.style(f"✓ 下载完成", fg='green'))
        click.echo(f"  文件大小: {file_size / (1024*1024):.2f} MB")
    except Exception as e:
        click.echo(click.style(f"✗ 下载失败: {e}", fg='red'))
        sys.exit(1)


@rebuild.command('nodes')
@click.argument('task_id')
@click.pass_context
def rebuild_nodes(ctx, task_id):
    """查看节点贡献统计"""
    api_client = ctx.obj['api_client']

    if not api_client.health_check():
        click.echo(click.style("错误: 无法连接到后端服务", fg='red'))
        sys.exit(1)

    try:
        contributions = api_client.get_node_contributions(task_id)
    except Exception as e:
        click.echo(click.style(f"✗ 获取节点贡献失败: {e}", fg='red'))
        sys.exit(1)

    if not contributions:
        click.echo("暂无节点贡献数据")
        return

    click.echo(f"任务ID: {task_id}")
    click.echo(f"\n节点贡献排行:")
    click.echo("-" * 80)
    click.echo(f"{'排名':<6} {'节点名称':<25} {'贡献块数':<12} {'唯一块数':<12} {'最后活跃':<25}")
    click.echo("-" * 80)

    for idx, contrib in enumerate(contributions, 1):
        name = contrib.get('node_name') or contrib['node_id'][:12]
        click.echo(f"{idx:<6} {name:<25} {contrib['blocks_contributed']:<12} "
                   f"{contrib['unique_blocks']:<12} {contrib['last_seen']:<25}")


@rebuild.command('heatmap')
@click.argument('task_id')
@click.option('--output', 'output_path', default=None,
              type=click.Path(dir_okay=False),
              help='保存热力图数据到JSON文件')
@click.pass_context
def rebuild_heatmap(ctx, task_id, output_path):
    """查看块收集热力图"""
    api_client = ctx.obj['api_client']

    if not api_client.health_check():
        click.echo(click.style("错误: 无法连接到后端服务", fg='red'))
        sys.exit(1)

    try:
        heatmap_data = api_client.get_block_heatmap(task_id)
    except Exception as e:
        click.echo(click.style(f"✗ 获取热力图失败: {e}", fg='red'))
        sys.exit(1)

    stats = heatmap_data['stats']
    click.echo(f"任务ID: {task_id}")
    click.echo(f"\n统计信息:")
    click.echo(f"  总块数: {heatmap_data['total_blocks']}")
    click.echo(f"  已恢复: {stats['recovered']}")
    click.echo(f"  已收集: {stats['collected']}")
    click.echo(f"  不可恢复: {stats['unrecoverable']}")
    click.echo(f"  缺失: {stats['missing']}")

    click.echo(f"\n块状态热力图:")
    click.echo("  ■ = 已恢复  □ = 已收集  × = 不可恢复  · = 缺失")

    heatmap = heatmap_data['heatmap']
    total_blocks = heatmap_data['total_blocks']

    status_map = {
        'recovered': '■',
        'collected': '□',
        'unrecoverable': '×',
        'missing': '·'
    }

    line_length = 100
    for start in range(0, total_blocks, line_length):
        end = min(start + line_length, total_blocks)
        line = []
        for i in range(start, end):
            status = heatmap[i]['status']
            line.append(status_map.get(status, '?'))
        click.echo(f"  {''.join(line)}")

    if output_path:
        import json
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(heatmap_data, f, indent=2, ensure_ascii=False)
        click.echo(f"\n热力图数据已保存到: {output_path}")


@cli.command('health')
@click.pass_context
def health_check(ctx):
    """检查后端服务健康状态"""
    api_client = ctx.obj['api_client']
    click.echo(f"检查服务: {ctx.obj['api_url']}")

    version = api_client.get_server_version()
    if version:
        click.echo(f"服务器版本: {version}")

    if api_client.health_check():
        click.echo(click.style("✓ 后端服务运行正常", fg='green'))
    else:
        click.echo(click.style("✗ 无法连接到后端服务", fg='red'))
        sys.exit(1)


if __name__ == '__main__':
    cli(obj={})
