from faiss_index import get_similarity_index

index = get_similarity_index()
print('Index built:', index.is_built())
print('Index size:', index.get_index_size())
print('Embedding dim:', index.get_embedding_dim())

results = index.search('CCO', top_k=5)
print(f'Search results: {len(results)}')
for r in results:
    print(f'  {r["name"]}: sim={r["similarity"]:.4f}, logP={r["logp"]}')
