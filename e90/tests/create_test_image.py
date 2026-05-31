#!/usr/bin/env python3
"""
创建测试镜像的脚本
"""
import os
import sys
import argparse


def create_image(output_path: str, size_mb: int):
    """创建指定大小的测试镜像"""
    size = size_mb * 1024 * 1024

    with open(output_path, 'wb') as f:
        chunk_size = 1024 * 1024
        remaining = size
        while remaining > 0:
            write_size = min(chunk_size, remaining)
            f.write(os.urandom(write_size))
            remaining -= write_size

    print(f"✓ 创建镜像: {output_path}")
    print(f"  大小: {size_mb} MB ({size} 字节)")
    print(f"  4KB 块数: {(size + 4095) // 4096}")


def create_text_image(output_path: str, size_mb: int):
    """创建包含文本内容的测试镜像（便于观察恢复效果）"""
    size = size_mb * 1024 * 1024
    text = "这是一段测试文本，用于验证数据恢复功能。" * 100
    text_bytes = text.encode('utf-8')

    with open(output_path, 'wb') as f:
        written = 0
        while written < size:
            write_size = min(len(text_bytes), size - written)
            f.write(text_bytes[:write_size])
            written += write_size

    print(f"✓ 创建文本镜像: {output_path}")
    print(f"  大小: {size_mb} MB")
    print(f"  内容: 重复的中文文本（便于观察恢复效果）")


def main():
    parser = argparse.ArgumentParser(description='创建测试用磁盘镜像')
    parser.add_argument('output', help='输出文件路径')
    parser.add_argument('--size', type=int, default=10, help='镜像大小（MB）')
    parser.add_argument('--text', action='store_true', help='创建包含文本内容的镜像')

    args = parser.parse_args()

    if args.text:
        create_text_image(args.output, args.size)
    else:
        create_image(args.output, args.size)


if __name__ == '__main__':
    main()
