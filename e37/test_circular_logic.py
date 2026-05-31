import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from unittest.mock import MagicMock, patch
from app import detect_circular_dependency

def test_detect_circular_dependency():
    print("=== 测试循环依赖检测逻辑 ===\n")
    
    print("1. 测试自依赖...")
    result = detect_circular_dependency('task_a', 'task_a')
    assert result == ['task_a', 'task_a'], f"Expected ['task_a', 'task_a'], got {result}"
    print(f"   ✅ 自依赖检测正确: {result}")
    
    print("\n2. 测试无循环的正常依赖链...")
    with patch('app.Task') as mock_task:
        mock_task.query.get.return_value = None
        result = detect_circular_dependency('task_c', 'task_b')
        assert result is None, f"Expected None, got {result}"
        print(f"   ✅ 正常依赖检测正确: {result}")
    
    print("\n3. 测试双向循环 (A→B→A)...")
    with patch('app.Task') as mock_task:
        mock_b = MagicMock()
        mock_b.depends_on = 'task_a'
        
        def get_task(task_id):
            if task_id == 'task_b':
                return mock_b
            return None
        
        mock_task.query.get = get_task
        result = detect_circular_dependency('task_a', 'task_b')
        assert result == ['task_a', 'task_b', 'task_a'], f"Expected ['task_a', 'task_b', 'task_a'], got {result}"
        print(f"   ✅ 双向循环检测正确: {result}")
    
    print("\n4. 测试长链循环 (A→B→C→A)...")
    with patch('app.Task') as mock_task:
        mock_b = MagicMock()
        mock_b.depends_on = 'task_c'
        mock_c = MagicMock()
        mock_c.depends_on = 'task_a'
        
        def get_task(task_id):
            if task_id == 'task_b':
                return mock_b
            elif task_id == 'task_c':
                return mock_c
            return None
        
        mock_task.query.get = get_task
        result = detect_circular_dependency('task_a', 'task_b')
        assert result == ['task_a', 'task_b', 'task_c', 'task_a'], f"Expected ['task_a', 'task_b', 'task_c', 'task_a'], got {result}"
        print(f"   ✅ 长链循环检测正确: {result}")
    
    print("\n5. 测试更长的依赖链 (A→B→C→D→B)...")
    with patch('app.Task') as mock_task:
        mock_b = MagicMock()
        mock_b.depends_on = 'task_c'
        mock_c = MagicMock()
        mock_c.depends_on = 'task_d'
        mock_d = MagicMock()
        mock_d.depends_on = 'task_b'
        
        def get_task(task_id):
            if task_id == 'task_b':
                return mock_b
            elif task_id == 'task_c':
                return mock_c
            elif task_id == 'task_d':
                return mock_d
            return None
        
        mock_task.query.get = get_task
        result = detect_circular_dependency('task_a', 'task_b')
        assert result == ['task_a', 'task_b', 'task_c', 'task_d', 'task_b'], f"Expected ['task_a', 'task_b', 'task_c', 'task_d', 'task_b'], got {result}"
        print(f"   ✅ 长链中循环检测正确: {result}")
    
    print("\n6. 测试无循环的正常长链 (A→B→C→D)...")
    with patch('app.Task') as mock_task:
        mock_b = MagicMock()
        mock_b.depends_on = 'task_c'
        mock_c = MagicMock()
        mock_c.depends_on = 'task_d'
        mock_d = MagicMock()
        mock_d.depends_on = None
        
        def get_task(task_id):
            if task_id == 'task_b':
                return mock_b
            elif task_id == 'task_c':
                return mock_c
            elif task_id == 'task_d':
                return mock_d
            return None
        
        mock_task.query.get = get_task
        result = detect_circular_dependency('task_a', 'task_b')
        assert result is None, f"Expected None, got {result}"
        print(f"   ✅ 正常长链检测正确: {result}")
    
    print("\n=== 所有测试通过！ ===")

if __name__ == '__main__':
    test_detect_circular_dependency()
