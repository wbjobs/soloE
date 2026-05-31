import requests

print("=== Test 1: Root ===")
r = requests.get('http://localhost:8000/')
print(r.json())

print("\n=== Test 2: State Vector (2 qubits) ===")
r = requests.get('http://localhost:8000/state_vector?numQubits=2')
data = r.json()
print('Basis states:', data['basisStates'])
print('State:', data['state'][:4])

print("\n=== Test 3: Apply H gate ===")
r = requests.post('http://localhost:8000/apply_gate', json={'gate': 'H', 'qubit': 0, 'numQubits': 2})
data = r.json()
for bs, s, p in zip(data['basisStates'], data['state'], data['probabilities']):
    print(f"{bs}: {s['real']:+.4f} + {s['imag']:+.4f}i, prob={p:.4f}")

print("\n=== Test 4: Run circuit with H + CNOT (Bell state) ===")
r = requests.post('http://localhost:8000/run_circuit', json={
    'gates': [
        {'type': 'H', 'qubit': 0, 'step': 0},
        {'type': 'CNOT', 'qubit': 1, 'control': 0, 'step': 1}
    ],
    'numQubits': 2
})
data = r.json()
for bs, s, p in zip(data['basisStates'], data['state'], data['probabilities']):
    print(f"{bs}: {s['real']:+.4f} + {s['imag']:+.4f}i, prob={p:.4f}")

print("\n=== Test 5: Measure qubit 0 ===")
r = requests.post('http://localhost:8000/measure', json={'qubit': 0, 'numQubits': 2, 'state': data['state']})
result = r.json()
print(f"Measurement result: {result['result']}")
print("Collapsed state:")
for bs, s, p in zip(result['basisStates'], result['collapsedState'], result['probabilities']):
    print(f"{bs}: {s['real']:+.4f} + {s['imag']:+.4f}i, prob={p:.4f}")
