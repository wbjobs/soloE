import requests
import json

API_BASE = 'http://localhost:8000'

print("=" * 60)
print("测试 1: 噪声类型列表")
print("=" * 60)
r = requests.get(f'{API_BASE}/noise_types')
print(f"状态码: {r.status_code}")
print(f"响应: {json.dumps(r.json(), indent=2, ensure_ascii=False)}")

print("\n" + "=" * 60)
print("测试 2: 应用比特翻转噪声")
print("=" * 60)
r = requests.post(f'{API_BASE}/apply_noise', json={
    'noiseType': 'bit_flip',
    'qubit': 0,
    'probability': 0.5,
    'numQubits': 1
})
data = r.json()
print(f"状态码: {r.status_code}")
print(f"噪声后态: real={data['state']['real']}, imag={data['state']['imag']}")

print("\n" + "=" * 60)
print("测试 3: 应用相位阻尼噪声")
print("=" * 60)
r = requests.post(f'{API_BASE}/apply_noise', json={
    'noiseType': 'phase_damping',
    'qubit': 0,
    'probability': 0.3,
    'numQubits': 1
})
data = r.json()
print(f"状态码: {r.status_code}")
print(f"噪声后态: real={data['state']['real']}, imag={data['state']['imag']}")

print("\n" + "=" * 60)
print("测试 4: 布洛赫球坐标 (初始态 |0⟩)")
print("=" * 60)
r = requests.get(f'{API_BASE}/bloch_coordinates?numQubits=1&qubit=0')
print(f"状态码: {r.status_code}")
coords = r.json()
print(f"坐标: x={coords['x']:.4f}, y={coords['y']:.4f}, z={coords['z']:.4f}")
print(f"预期: x=0, y=0, z=1 (|0⟩ 态在北极)")

print("\n" + "=" * 60)
print("测试 5: 布洛赫球坐标 (H 门后)")
print("=" * 60)
# 先应用 H 门
r = requests.post(f'{API_BASE}/apply_gate', json={
    'gate': 'H',
    'qubit': 0,
    'numQubits': 1
})
data = r.json()
state_json = json.dumps(data['state'])
r = requests.get(f'{API_BASE}/bloch_coordinates?numQubits=1&qubit=0&state={state_json}')
coords = r.json()
print(f"状态码: {r.status_code}")
print(f"坐标: x={coords['x']:.4f}, y={coords['y']:.4f}, z={coords['z']:.4f}")
print(f"预期: x≈1, y≈0, z≈0 (H 门后指向 X 轴)")

print("\n" + "=" * 60)
print("测试 6: 运行带噪声的电路")
print("=" * 60)
r = requests.post(f'{API_BASE}/run_circuit', json={
    'gates': [
        {'type': 'H', 'qubit': 0, 'step': 0},
        {'type': 'CNOT', 'qubit': 1, 'control': 0, 'step': 1}
    ],
    'numQubits': 2,
    'bitFlipProbability': 0.1,
    'phaseDampingGamma': 0.05
})
data = r.json()
print(f"状态码: {r.status_code}")
print("概率分布:")
for bs, p in zip(data['basisStates'], data['probabilities']):
    if p > 0.01:
        print(f"  {bs}: {p:.4f}")

print("\n" + "=" * 60)
print("测试 7: 导出 QASM")
print("=" * 60)
r = requests.post(f'{API_BASE}/export_qasm', json={
    'gates': [
        {'type': 'H', 'qubit': 0, 'step': 0},
        {'type': 'CNOT', 'qubit': 1, 'control': 0, 'step': 1},
        {'type': 'X', 'qubit': 2, 'step': 2},
        {'type': 'Y', 'qubit': 0, 'step': 3},
        {'type': 'S', 'qubit': 1, 'step': 4},
        {'type': 'T', 'qubit': 2, 'step': 5}
    ],
    'numQubits': 3,
    'circuitName': 'bell_state'
})
print(f"状态码: {r.status_code}")
print("QASM 内容:")
print("-" * 40)
print(r.text)
print("-" * 40)

print("\n" + "=" * 60)
print("所有新功能测试完成!")
print("=" * 60)
