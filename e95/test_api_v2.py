import requests
import json

API_BASE = 'http://localhost:8000'

print("=" * 60)
print("测试 1: 根路径")
print("=" * 60)
r = requests.get(f'{API_BASE}/')
print(f"状态码: {r.status_code}")
print(f"响应: {json.dumps(r.json(), indent=2, ensure_ascii=False)}")

print("\n" + "=" * 60)
print("测试 2: 获取初始态矢量 (2 qubits) - 验证新格式")
print("=" * 60)
r = requests.get(f'{API_BASE}/state_vector?numQubits=2')
data = r.json()
print(f"状态码: {r.status_code}")
print(f"numQubits: {data['numQubits']}")
print(f"basisStates: {data['basisStates']}")
print(f"state.real (前4个): {data['state']['real'][:4]}")
print(f"state.imag (前4个): {data['state']['imag'][:4]}")
print(f"probabilities (前4个): {data['probabilities'][:4]}")

print("\n" + "=" * 60)
print("测试 3: 应用 H 门")
print("=" * 60)
r = requests.post(f'{API_BASE}/apply_gate', json={
    'gate': 'H',
    'qubit': 0,
    'numQubits': 2
})
data = r.json()
print(f"状态码: {r.status_code}")
print("应用 H 门后的态:")
for i, (bs, re, im, p) in enumerate(zip(
    data['basisStates'],
    data['state']['real'],
    data['state']['imag'],
    data['probabilities']
)):
    print(f"  {bs}: {re:+.4f} + {im:+.4f}i, prob={p:.4f}")

print("\n" + "=" * 60)
print("测试 4: 运行 Bell 态电路 (H + CNOT)")
print("=" * 60)
r = requests.post(f'{API_BASE}/run_circuit', json={
    'gates': [
        {'type': 'H', 'qubit': 0, 'step': 0},
        {'type': 'CNOT', 'qubit': 1, 'control': 0, 'step': 1}
    ],
    'numQubits': 2
})
data = r.json()
print(f"状态码: {r.status_code}")
print("Bell 态 (|00⟩ + |11⟩)/√2:")
for i, (bs, re, im, p) in enumerate(zip(
    data['basisStates'],
    data['state']['real'],
    data['state']['imag'],
    data['probabilities']
)):
    print(f"  {bs}: {re:+.4f} + {im:+.4f}i, prob={p:.4f}")

print("\n" + "=" * 60)
print("测试 5: 测量 - 验证概率归一化")
print("=" * 60)
# 先获取 Bell 态
r = requests.post(f'{API_BASE}/run_circuit', json={
    'gates': [
        {'type': 'H', 'qubit': 0, 'step': 0},
        {'type': 'CNOT', 'qubit': 1, 'control': 0, 'step': 1}
    ],
    'numQubits': 2
})
bell_state = r.json()

# 测量 qubit 0
r = requests.post(f'{API_BASE}/measure', json={
    'qubit': 0,
    'numQubits': 2,
    'state': bell_state['state']
})
result = r.json()
print(f"状态码: {r.status_code}")
print(f"测量结果: q{result['qubit']} = |{result['result']}⟩")
print("坍缩后的态:")
for i, (bs, re, im, p) in enumerate(zip(
    result['basisStates'],
    result['collapsedState']['real'],
    result['collapsedState']['imag'],
    result['probabilities']
)):
    print(f"  {bs}: {re:+.4f} + {im:+.4f}i, prob={p:.4f}")

print("\n" + "=" * 60)
print("测试 6: 12 量子比特 - 验证内存优化")
print("=" * 60)
import time
start = time.time()
r = requests.get(f'{API_BASE}/state_vector?numQubits=12')
data = r.json()
end = time.time()
print(f"状态码: {r.status_code}")
print(f"量子比特数: {data['numQubits']}")
print(f"态矢量维度: 2^{data['numQubits']} = {len(data['state']['real'])}")
print(f"获取态矢量耗时: {(end - start) * 1000:.2f} ms")

# 测试在 12 量子比特上应用 H 门
start = time.time()
r = requests.post(f'{API_BASE}/apply_gate', json={
    'gate': 'H',
    'qubit': 0,
    'numQubits': 12
})
data = r.json()
end = time.time()
non_zero = sum(1 for p in data['probabilities'] if p > 0.0001)
print(f"应用 H 门耗时: {(end - start) * 1000:.2f} ms")
print(f"非零概率态数量: {non_zero}")

print("\n" + "=" * 60)
print("所有测试完成!")
print("=" * 60)
