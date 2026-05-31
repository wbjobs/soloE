import numpy as np
from typing import List, Dict, Any, Optional, Tuple

try:
    import faiss
    FAISS_AVAILABLE = True
except ImportError:
    FAISS_AVAILABLE = False

from molecule_library import get_library, get_smiles_list, get_molecule_by_index, get_library_size
from model import MockGNNModel, get_model


class MoleculeSimilarityIndex:
    def __init__(self):
        self._index = None
        self._embeddings: Optional[np.ndarray] = None
        self._library_size = 0
        self._model: Optional[MockGNNModel] = None
        self._embedding_dim = 0
        self._built = False

    def build(self) -> bool:
        print("[FAISS] Building molecule similarity index...")

        self._model = get_model()
        self._embedding_dim = self._model.get_embedding_dim()
        self._library_size = get_library_size()

        if self._library_size == 0:
            print("[FAISS] No molecules in library")
            return False

        smiles_list = get_smiles_list()
        embeddings = []

        for idx, smiles in enumerate(smiles_list):
            embedding = self._model.get_embedding(smiles)
            if embedding is not None:
                if embedding.shape[0] != self._embedding_dim:
                    if embedding.shape[0] < self._embedding_dim:
                        padded = np.zeros(self._embedding_dim, dtype=np.float32)
                        padded[:embedding.shape[0]] = embedding
                        embeddings.append(padded)
                    else:
                        embeddings.append(embedding[:self._embedding_dim])
                else:
                    embeddings.append(embedding)
            else:
                embeddings.append(np.zeros(self._embedding_dim, dtype=np.float32))

            if (idx + 1) % 10 == 0:
                print(f"[FAISS] Processed {idx + 1}/{self._library_size} molecules")

        self._embeddings = np.array(embeddings, dtype=np.float32)

        if FAISS_AVAILABLE:
            self._index = faiss.IndexFlatL2(self._embedding_dim)
            faiss.normalize_L2(self._embeddings)
            self._index.add(self._embeddings)
            print(f"[FAISS] Index built with {self._index.ntotal} molecules (FAISS backend)")
        else:
            print(f"[FAISS] FAISS not available, using numpy backend with {len(self._embeddings)} molecules")

        self._built = True
        return True

    def search(self, query_smiles: str, top_k: int = 5) -> List[Dict[str, Any]]:
        if not self._built:
            self.build()

        if self._model is None:
            self._model = get_model()

        query_embedding = self._model.get_embedding(query_smiles)
        if query_embedding is None:
            return []

        if query_embedding.shape[0] != self._embedding_dim:
            if query_embedding.shape[0] < self._embedding_dim:
                padded = np.zeros(self._embedding_dim, dtype=np.float32)
                padded[:query_embedding.shape[0]] = query_embedding
                query_embedding = padded
            else:
                query_embedding = query_embedding[:self._embedding_dim]

        query_embedding = query_embedding.reshape(1, -1).astype(np.float32)

        if FAISS_AVAILABLE and self._index is not None:
            faiss.normalize_L2(query_embedding)
            distances, indices = self._index.search(query_embedding, min(top_k, self._library_size))
            similarities = 1.0 - (distances[0] / 2.0)
        else:
            similarities, indices = self._numpy_search(query_embedding, top_k)

        results = []
        sims_flat = similarities.flatten() if hasattr(similarities, 'flatten') else similarities
        for i, idx in enumerate(indices[0]):
            idx_int = int(idx)
            sim_float = float(sims_flat[i])
            molecule = get_molecule_by_index(idx_int)
            if molecule:
                results.append({
                    "rank": i + 1,
                    "smiles": molecule["smiles"],
                    "name": molecule.get("name", "Unknown"),
                    "logp": molecule.get("logp", 0.0),
                    "similarity": sim_float,
                    "solubility_class": self._model._classify_logp(molecule.get("logp", 0.0)) if self._model else "Unknown"
                })

        return results

    def _numpy_search(self, query_embedding: np.ndarray, top_k: int) -> Tuple[np.ndarray, np.ndarray]:
        if self._embeddings is None:
            return np.array([]), np.array([])

        query_norm = np.linalg.norm(query_embedding)
        embeddings_norm = np.linalg.norm(self._embeddings, axis=1, keepdims=True)
        similarities = np.dot(self._embeddings, query_embedding.T) / (embeddings_norm * query_norm + 1e-8)
        similarities = similarities.flatten()

        top_indices = np.argsort(similarities)[::-1][:top_k]
        top_similarities = similarities[top_indices]

        return top_similarities.reshape(1, -1), top_indices.reshape(1, -1)

    def is_built(self) -> bool:
        return self._built

    def get_index_size(self) -> int:
        if FAISS_AVAILABLE and self._index is not None:
            return self._index.ntotal
        return len(self._embeddings) if self._embeddings is not None else 0

    def get_embedding_dim(self) -> int:
        return self._embedding_dim


_index_instance: Optional[MoleculeSimilarityIndex] = None


def get_similarity_index() -> MoleculeSimilarityIndex:
    global _index_instance
    if _index_instance is None:
        _index_instance = MoleculeSimilarityIndex()
        _index_instance.build()
    return _index_instance


def search_similar_molecules(smiles: str, top_k: int = 5) -> List[Dict[str, Any]]:
    index = get_similarity_index()
    return index.search(smiles, top_k)
