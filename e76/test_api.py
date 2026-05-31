import requests
import time

BASE_URL = "http://localhost:8001"


def test_root():
    print("=== Testing Root Endpoint ===")
    response = requests.get(f"{BASE_URL}/")
    print(f"Status: {response.status_code}")
    data = response.json()
    print(f"Message: {data['message']}")
    print(f"Version: {data['version']}")
    print(f"Model loaded: {data['model_loaded']}")
    print(f"Similarity index built: {data.get('similarity_index_built', 'N/A')}")
    print(f"Library size: {data.get('library_size', 'N/A')}")
    print()


def test_health():
    print("=== Testing Health Check ===")
    response = requests.get(f"{BASE_URL}/health")
    print(f"Status: {response.status_code}")
    data = response.json()
    print(f"Status: {data['status']}")
    print(f"Model loaded: {data['model_loaded']}")
    print(f"Model device: {data.get('model_device', 'N/A')}")
    print()


def test_single_predict():
    print("=== Testing Single Prediction ===")
    test_cases = ["CCO", "c1ccccc1", "CC(=O)O"]
    for smiles in test_cases:
        response = requests.post(
            f"{BASE_URL}/api/v1/predict",
            json={"smiles": smiles}
        )
        print(f"SMILES: {smiles}")
        print(f"Status: {response.status_code}")
        data = response.json()
        print(f"  logP: {data['logp']}")
        print(f"  Class: {data['solubility_class']}")
        print(f"  Valid: {data['valid']}")
    print()


def test_library_info():
    print("=== Testing Library Info ===")
    response = requests.get(f"{BASE_URL}/api/v1/similar/library")
    print(f"Status: {response.status_code}")
    data = response.json()
    print(f"Total molecules: {data['total_molecules']}")
    print(f"First 3 molecules:")
    for mol in data['molecules'][:3]:
        print(f"  {mol['name']}: {mol['smiles']} (logP={mol['logp']})")
    print()


def test_similar_search():
    print("=== Testing Similar Molecule Search ===")
    test_queries = [
        ("CCO", 5),
        ("c1ccccc1", 3),
        ("CC(=O)O", 5)
    ]

    for smiles, top_k in test_queries:
        response = requests.get(
            f"{BASE_URL}/api/v1/similar/search",
            params={"smiles": smiles, "top_k": top_k}
        )
        print(f"Query: {smiles}, top_k={top_k}")
        print(f"Status: {response.status_code}")

        if response.status_code == 200:
            data = response.json()
            print(f"Query SMILES: {data['query_smiles']}")
            print(f"Library size: {data['library_size']}")
            print(f"Backend: {data['backend']}")
            print(f"Results ({len(data['results'])}):")
            for r in data['results']:
                print(f"  Rank {r['rank']}: {r['name']} (logP={r['logp']:.2f}, similarity={r['similarity']:.4f})")
        print()


def test_similar_search_post():
    print("=== Testing Similar Molecule Search (POST) ===")
    response = requests.post(
        f"{BASE_URL}/api/v1/similar/search",
        json={"smiles": "CCO", "top_k": 3}
    )
    print(f"Status: {response.status_code}")
    if response.status_code == 200:
        data = response.json()
        print(f"Query: {data['query_smiles']}")
        print(f"Results: {len(data['results'])}")
        for r in data['results']:
            print(f"  {r['name']}: sim={r['similarity']:.4f}")
    print()


def test_invalid_smiles():
    print("=== Testing Invalid SMILES ===")
    response = requests.get(
        f"{BASE_URL}/api/v1/similar/search",
        params={"smiles": "invalid_smiles", "top_k": 5}
    )
    print(f"Status: {response.status_code}")
    if response.status_code != 200:
        print(f"Error: {response.json().get('detail', 'Unknown')}")
    print()


def test_embedding_extraction():
    print("=== Testing Embedding Extraction (Model) ===")
    try:
        from model import get_model
        model = get_model()
        embedding = model.get_embedding("CCO")
        print(f"Embedding shape: {embedding.shape}")
        print(f"Embedding dtype: {embedding.dtype}")
        print(f"First 5 values: {embedding[:5]}")
    except Exception as e:
        print(f"Error: {e}")
    print()


if __name__ == "__main__":
    test_root()
    test_health()
    test_single_predict()
    test_library_info()
    test_similar_search()
    test_similar_search_post()
    test_invalid_smiles()
    test_embedding_extraction()
    print("=== All tests completed ===")
