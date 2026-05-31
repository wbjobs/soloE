import re
import math
import time
import threading
from typing import Dict, Any, List, Optional, Tuple
from collections import defaultdict

from ..models.schemas import QueryResponse


STOPWORDS = {
    "的", "是", "什么", "哪个", "在", "和", "与", "及", "了", "吗", "呢", "啊",
    "请", "查询", "统计", "显示", "展示", "获取", "查找", "搜索",
    "the", "is", "what", "which", "of", "in", "on", "at", "to", "for",
    "please", "show", "get", "find", "search", "query", "count", "sum",
}


def preprocess_text(text: str) -> str:
    text = text.lower()
    text = re.sub(r'[^\w\u4e00-\u9fa5\s]', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def tokenize(text: str, ngram_size: int = 2) -> List[str]:
    text = preprocess_text(text)
    tokens = []

    for ch in text:
        if ch == ' ' or ch in STOPWORDS:
            continue
        tokens.append(ch)

    if len(tokens) >= ngram_size:
        for i in range(len(tokens) - ngram_size + 1):
            tokens.append(''.join(tokens[i:i + ngram_size]))

    return tokens


def build_vector(tokens: List[str]) -> Dict[str, int]:
    vector = defaultdict(int)
    for token in tokens:
        vector[token] += 1
    return dict(vector)


def cosine_similarity(vec1: Dict[str, int], vec2: Dict[str, int]) -> float:
    dot_product = sum(vec1.get(k, 0) * vec2.get(k, 0) for k in set(vec1.keys()) & set(vec2.keys()))

    norm1 = math.sqrt(sum(v ** 2 for v in vec1.values()))
    norm2 = math.sqrt(sum(v ** 2 for v in vec2.values()))

    if norm1 == 0 or norm2 == 0:
        return 0.0

    return dot_product / (norm1 * norm2)


def mock_embedding_similarity(text1: str, text2: str) -> float:
    vec1 = build_vector(tokenize(text1, ngram_size=2))
    vec2 = build_vector(tokenize(text2, ngram_size=2))
    sim = cosine_similarity(vec1, vec2)

    tokens1 = set(tokenize(text1, ngram_size=1))
    tokens2 = set(tokenize(text2, ngram_size=1))
    if tokens1 and tokens2:
        jaccard = len(tokens1 & tokens2) / len(tokens1 | tokens2)
        sim = 0.7 * sim + 0.3 * jaccard

    return round(sim, 4)


class CacheEntry:
    def __init__(self, key: str, response: QueryResponse, ttl_seconds: int):
        self.key = key
        self.response = response
        self.created_at = time.time()
        self.expires_at = self.created_at + ttl_seconds
        self.access_count = 0

    def is_expired(self) -> bool:
        return time.time() > self.expires_at

    def access(self) -> QueryResponse:
        self.access_count += 1
        return self.response


class QueryCache:
    def __init__(self, ttl_seconds: int = 600, similarity_threshold: float = 0.95, max_size: int = 1000):
        self.ttl_seconds = ttl_seconds
        self.similarity_threshold = similarity_threshold
        self.max_size = max_size
        self._cache: Dict[str, CacheEntry] = {}
        self._vectors: Dict[str, Dict[str, int]] = {}
        self._lock = threading.RLock()
        self._hits = 0
        self._misses = 0
        self._semantic_hits = 0

    def get(self, question: str) -> Optional[QueryResponse]:
        with self._lock:
            exact_key = self._make_key(question)
            if exact_key in self._cache:
                entry = self._cache[exact_key]
                if not entry.is_expired():
                    self._hits += 1
                    return entry.access()
                else:
                    self._remove(exact_key)

            question_vec = build_vector(tokenize(question))
            best_sim = 0.0
            best_key = None

            for key, vec in self._vectors.items():
                if key in self._cache and self._cache[key].is_expired():
                    continue
                sim = cosine_similarity(question_vec, vec)
                if sim > best_sim:
                    best_sim = sim
                    best_key = key

            if best_key and best_sim >= self.similarity_threshold:
                entry = self._cache[best_key]
                if not entry.is_expired():
                    self._semantic_hits += 1
                    cached_response = entry.access()
                    return self._clone_response_with_warning(
                        cached_response,
                        f"缓存命中（语义相似度: {best_sim:.2%}，原问题: '{entry.key}'）"
                    )

            self._misses += 1
            return None

    def set(self, question: str, response: QueryResponse) -> None:
        with self._lock:
            self._cleanup_expired()

            if len(self._cache) >= self.max_size:
                self._evict_lru()

            key = self._make_key(question)
            entry = CacheEntry(key, response, self.ttl_seconds)
            self._cache[key] = entry
            self._vectors[key] = build_vector(tokenize(question))

    def _make_key(self, question: str) -> str:
        return preprocess_text(question)

    def _remove(self, key: str) -> None:
        if key in self._cache:
            del self._cache[key]
        if key in self._vectors:
            del self._vectors[key]

    def _cleanup_expired(self) -> None:
        expired_keys = [k for k, v in self._cache.items() if v.is_expired()]
        for k in expired_keys:
            self._remove(k)

    def _evict_lru(self) -> None:
        if not self._cache:
            return
        oldest_key = min(self._cache.keys(), key=lambda k: self._cache[k].created_at)
        self._remove(oldest_key)

    def _clone_response_with_warning(self, response: QueryResponse, warning: str) -> QueryResponse:
        new_warnings = list(response.warnings)
        new_warnings.append(warning)
        return QueryResponse(
            question=response.question,
            logical_plan=response.logical_plan,
            sub_query_results=response.sub_query_results,
            final_result=response.final_result,
            execution_time_ms=response.execution_time_ms,
            warnings=new_warnings,
        )

    def clear(self) -> None:
        with self._lock:
            self._cache.clear()
            self._vectors.clear()
            self._hits = 0
            self._misses = 0
            self._semantic_hits = 0

    def stats(self) -> Dict[str, Any]:
        with self._lock:
            total = self._hits + self._semantic_hits + self._misses
            hit_rate = (self._hits + self._semantic_hits) / total if total > 0 else 0.0
            return {
                "size": len(self._cache),
                "max_size": self.max_size,
                "ttl_seconds": self.ttl_seconds,
                "similarity_threshold": self.similarity_threshold,
                "hits": self._hits,
                "semantic_hits": self._semantic_hits,
                "misses": self._misses,
                "hit_rate": round(hit_rate, 4),
            }


_instance: Optional[QueryCache] = None


def get_cache() -> QueryCache:
    global _instance
    if _instance is None:
        _instance = QueryCache(ttl_seconds=600, similarity_threshold=0.95, max_size=1000)
    return _instance
