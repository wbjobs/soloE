import hashlib
import numpy as np
from typing import List, Optional

try:
    import torch
    import torch.nn as nn
    TORCH_AVAILABLE = True

    class LogPPredictorMLP(nn.Module):
        def __init__(self, input_dim: int = 2048, hidden_dim: int = 256, num_layers: int = 3):
            super().__init__()
            self.input_dim = input_dim
            self.hidden_dim = hidden_dim
            self.num_layers = num_layers

            layers = []
            layers.append(nn.Linear(input_dim, hidden_dim))
            layers.append(nn.ReLU())
            layers.append(nn.Dropout(0.2))

            for _ in range(num_layers - 1):
                layers.append(nn.Linear(hidden_dim, hidden_dim))
                layers.append(nn.ReLU())
                layers.append(nn.Dropout(0.2))

            layers.append(nn.Linear(hidden_dim, 1))
            self.network = nn.Sequential(*layers)

        def forward(self, x):
            return self.network(x)

except ImportError:
    TORCH_AVAILABLE = False
    LogPPredictorMLP = None

from molecule_utils import get_molecular_features


class MockGNNModel:
    def __init__(self):
        self._loaded = False
        self._model: Optional[LogPPredictorMLP] = None
        self._model_params = None
        self._device = torch.device('cpu') if TORCH_AVAILABLE else 'cpu'

    def load(self, model_path: str = None) -> bool:
        print(f"[MockGNNModel] Loading pre-trained GNN model (mock)...")

        if TORCH_AVAILABLE:
            self._model = LogPPredictorMLP(input_dim=2048, hidden_dim=256, num_layers=3)

            if model_path and model_path != "mock":
                try:
                    state_dict = torch.load(model_path, map_location=self._device)
                    self._model.load_state_dict(state_dict)
                    print(f"[MockGNNModel] Model weights loaded from {model_path}")
                except Exception as e:
                    print(f"[MockGNNModel] Could not load weights, using random init: {e}")
            else:
                print(f"[MockGNNModel] Using mock model with random initialization (map_location={self._device})")

            self._model.eval()
            self._model.to(self._device)

        self._model_params = {
            "hidden_dim": 256,
            "num_layers": 3,
            "dropout": 0.2,
            "pretrained": True,
            "device": str(self._device),
            "torch_available": TORCH_AVAILABLE
        }

        self._loaded = True
        print(f"[MockGNNModel] Model loaded successfully. Params: {self._model_params}")
        return True

    def _deterministic_mock_predict(self, smiles: str) -> float:
        hash_obj = hashlib.md5(smiles.encode())
        hash_int = int(hash_obj.hexdigest(), 16)
        normalized = (hash_int % 10000) / 10000.0
        logp = (normalized * 8.0) - 2.0
        return round(logp, 4)

    def predict(self, smiles: str) -> float:
        if not self._loaded:
            raise RuntimeError("Model not loaded. Call load() first.")

        features = get_molecular_features(smiles)

        if features is not None and TORCH_AVAILABLE and self._model is not None:
            try:
                with torch.no_grad():
                    features_tensor = torch.tensor(features, dtype=torch.float32, device=self._device)
                    features_tensor = features_tensor.unsqueeze(0)
                    prediction = self._model(features_tensor)
                    logp = prediction.item()

                    fp_sum = float(np.sum(features))
                    hash_obj = hashlib.md5(smiles.encode())
                    hash_int = int(hash_obj.hexdigest(), 16)
                    base = (hash_int % 10000) / 10000.0
                    logp = (base * 10.0) - 3.0 + (fp_sum * 0.001) + (logp * 0.1)
                    return round(logp, 4)
            except Exception as e:
                print(f"[MockGNNModel] Torch prediction failed, falling back: {e}")

        return self._deterministic_mock_predict(smiles)

    def predict_batch(self, smiles_list: List[str]) -> List[dict]:
        results = []
        for idx, smiles in enumerate(smiles_list):
            logp = self.predict(smiles)
            results.append({
                "index": idx,
                "smiles": smiles,
                "logp": logp,
                "solubility_class": self._classify_logp(logp)
            })
        return results

    def _classify_logp(self, logp: float) -> str:
        if logp < 0:
            return "Highly Soluble"
        elif logp < 2:
            return "Soluble"
        elif logp < 4:
            return "Moderately Soluble"
        else:
            return "Poorly Soluble"

    @property
    def is_loaded(self) -> bool:
        return self._loaded

    @property
    def device(self) -> str:
        return str(self._device)

    def get_embedding(self, smiles: str) -> Optional[np.ndarray]:
        if not self._loaded:
            raise RuntimeError("Model not loaded. Call load() first.")

        features = get_molecular_features(smiles)
        if features is None:
            return None

        if TORCH_AVAILABLE and self._model is not None:
            try:
                with torch.no_grad():
                    features_tensor = torch.tensor(features, dtype=torch.float32, device=self._device)
                    features_tensor = features_tensor.unsqueeze(0)

                    embedding = features_tensor
                    for i, layer in enumerate(self._model.network):
                        embedding = layer(embedding)
                        if i == 2:
                            break

                    embedding_np = embedding.squeeze(0).cpu().numpy()
                    return embedding_np.astype(np.float32)
            except Exception as e:
                print(f"[MockGNNModel] Embedding extraction failed, using raw features: {e}")

        return features.astype(np.float32)

    def get_embedding_dim(self) -> int:
        if TORCH_AVAILABLE and self._model is not None:
            return self._model.hidden_dim
        return 2048


_model_instance = None


def get_model() -> MockGNNModel:
    global _model_instance
    if _model_instance is None:
        _model_instance = MockGNNModel()
        _model_instance.load()
    return _model_instance
