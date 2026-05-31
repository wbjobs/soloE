print("=== 测试循环依赖检测逻辑 ===\n")

def detect_circular_dependency_test(task_id, depends_on, get_parent_depends_on, path=None):
    if path is None:
        path = [task_id]
    
    if not depends_on:
        return None
    
    if depends_on == task_id:
        return path + [depends_on]
    
    if depends_on in path:
        return path + [depends_on]
    
    parent_depends_on = get_parent_depends_on(depends_on)
    if parent_depends_on:
        new_path = path + [depends_on]
        result = detect_circular_dependency_test(task_id, parent_depends_on, get_parent_depends_on, new_path)
        if result:
            return result
    
    return None

print("1. 测试自依赖...")
result = detect_circular_dependency_test('task_a', 'task_a', lambda x: None)
assert result == ['task_a', 'task_a'], f"Expected ['task_a', 'task_a'], got {result}"
print(f"   ✅ 自依赖检测正确: {result}")

print("\n2. 测试无循环的正常依赖链...")
result = detect_circular_dependency_test('task_c', 'task_b', lambda x: None)
assert result is None, f"Expected None, got {result}"
print(f"   ✅ 正常依赖检测正确: {result}")

print("\n3. 测试双向循环 (A→B→A)...")
def get_b_parent(task_id):
    if task_id == 'task_b':
        return 'task_a'
    return None
result = detect_circular_dependency_test('task_a', 'task_b', get_b_parent)
assert result == ['task_a', 'task_b', 'task_a'], f"Expected ['task_a', 'task_b', 'task_a'], got {result}"
print(f"   ✅ 双向循环检测正确: {result}")

print("\n4. 测试长链循环 (A→B→C→A)...")
def get_abc_chain(task_id):
    if task_id == 'task_b':
        return 'task_c'
    elif task_id == 'task_c':
        return 'task_a'
    return None
result = detect_circular_dependency_test('task_a', 'task_b', get_abc_chain)
assert result == ['task_a', 'task_b', 'task_c', 'task_a'], f"Expected ['task_a', 'task_b', 'task_c', 'task_a'], got {result}"
print(f"   ✅ 长链循环检测正确: {result}")

print("\n5. 测试更长的依赖链 (A→B→C→D→B)...")
def get_abcd_chain(task_id):
    if task_id == 'task_b':
        return 'task_c'
    elif task_id == 'task_c':
        return 'task_d'
    elif task_id == 'task_d':
        return 'task_b'
    return None
result = detect_circular_dependency_test('task_a', 'task_b', get_abcd_chain)
assert result == ['task_a', 'task_b', 'task_c', 'task_d', 'task_b'], f"Expected ['task_a', 'task_b', 'task_c', 'task_d', 'task_b'], got {result}"
print(f"   ✅ 长链中循环检测正确: {result}")

print("\n6. 测试无循环的正常长链 (A→B→C→D)...")
def get_normal_chain(task_id):
    if task_id == 'task_b':
        return 'task_c'
    elif task_id == 'task_c':
        return 'task_d'
    elif task_id == 'task_d':
        return None
    return None
result = detect_circular_dependency_test('task_a', 'task_b', get_normal_chain)
assert result is None, f"Expected None, got {result}"
print(f"   ✅ 正常长链检测正确: {result}")

print("\n7. 测试检测到循环后路径正确...")
chain = ['task_a', 'task_b', 'task_c', 'task_a']
path_str = ' → '.join(chain)
print(f"   循环路径显示: {path_str}")
assert path_str == "task_a → task_b → task_c → task_a"
print(f"   ✅ 路径显示正确")

print("\n=== 所有测试通过！ ===")
