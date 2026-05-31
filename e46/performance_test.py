import time
import numpy as np
import multiprocessing as mp
import matplotlib.pyplot as plt

def original_simulate_chunk(args):
    S, K, T, r, sigma, option_type, chunk_size, seed = args
    np.random.seed(seed)
    
    dt = T
    drift = (r - 0.5 * sigma**2) * dt
    diffusion = sigma * np.sqrt(dt)
    
    Z = np.random.standard_normal(chunk_size)
    ST = S * np.exp(drift + diffusion * Z)
    
    if option_type == 'call':
        payoff = np.maximum(ST - K, 0)
    else:
        payoff = np.maximum(K - ST, 0)
    
    discounted_payoff = np.exp(-r * T) * payoff
    
    return discounted_payoff.tolist(), ST.tolist()

def optimized_simulate_chunk(args):
    S, K, T, r, sigma, option_type, chunk_size, seed = args
    np.random.seed(seed)
    
    dt = T
    drift = (r - 0.5 * sigma**2) * dt
    diffusion = sigma * np.sqrt(dt)
    
    Z = np.random.standard_normal(chunk_size)
    ST = S * np.exp(drift + diffusion * Z)
    
    if option_type == 'call':
        payoff = np.maximum(ST - K, 0)
    else:
        payoff = np.maximum(K - ST, 0)
    
    discounted_payoff = np.exp(-r * T) * payoff
    
    chunk_sum = float(np.sum(discounted_payoff))
    chunk_sum_sq = float(np.sum(discounted_payoff ** 2))
    
    sorted_payoffs = np.sort(discounted_payoff)
    n_points = 100
    indices = np.linspace(0, chunk_size - 1, n_points, dtype=int)
    convergence_samples = sorted_payoffs[indices].tolist()
    
    histogram_samples = ST[::max(1, chunk_size // 2000)].tolist()
    
    return chunk_sum, chunk_sum_sq, chunk_size, convergence_samples, histogram_samples

def run_benchmark(num_simulations, num_workers):
    S, K, T, r, sigma, option_type = 100.0, 100.0, 1.0, 0.05, 0.2, 'call'
    
    chunk_size = num_simulations // num_workers
    remaining = num_simulations % num_workers
    
    seeds = [np.random.randint(0, 1000000) for _ in range(num_workers)]
    
    args_list = []
    for i in range(num_workers):
        current_chunk = chunk_size + (1 if i < remaining else 0)
        args_list.append((S, K, T, r, sigma, option_type, current_chunk, seeds[i]))
    
    print(f"\n=== Benchmark: {num_simulations:,} simulations, {num_workers} workers ===")
    
    start = time.time()
    with mp.Pool(num_workers) as pool:
        original_results = pool.map(original_simulate_chunk, args_list)
    original_time = time.time() - start
    
    total_payoffs_data = sum(len(r[0]) for r in original_results)
    total_ST_data = sum(len(r[1]) for r in original_results)
    original_data_mb = (total_payoffs_data + total_ST_data) * 8 / 1024 / 1024
    
    print(f"Original implementation: {original_time:.3f}s")
    print(f"  Data transferred: {original_data_mb:.2f} MB")
    
    start = time.time()
    with mp.Pool(num_workers) as pool:
        optimized_results = pool.map(optimized_simulate_chunk, args_list)
    optimized_time = time.time() - start
    
    total_conv = sum(len(r[3]) for r in optimized_results)
    total_hist = sum(len(r[4]) for r in optimized_results)
    optimized_data_mb = (total_conv + total_hist) * 8 / 1024 / 1024
    
    print(f"Optimized implementation: {optimized_time:.3f}s")
    print(f"  Data transferred: {optimized_data_mb:.2f} MB")
    
    speedup = original_time / optimized_time
    data_reduction = (1 - optimized_data_mb / original_data_mb) * 100
    
    print(f"\nSpeedup: {speedup:.2f}x")
    print(f"Data reduction: {data_reduction:.1f}%")
    
    original_price = sum(sum(r[0]) for r in original_results) / num_simulations
    optimized_price = sum(r[0] for r in optimized_results) / num_simulations
    
    print(f"Original price: {original_price:.6f}")
    print(f"Optimized price: {optimized_price:.6f}")
    print(f"Price difference: {abs(original_price - optimized_price):.10f}")
    
    return {
        'num_simulations': num_simulations,
        'num_workers': num_workers,
        'original_time': original_time,
        'optimized_time': optimized_time,
        'speedup': speedup,
        'original_data_mb': original_data_mb,
        'optimized_data_mb': optimized_data_mb,
        'data_reduction': data_reduction
    }

def main():
    mp.freeze_support()
    
    print("Monte Carlo Option Pricing - Performance Benchmark")
    print("=" * 60)
    
    num_workers = mp.cpu_count()
    print(f"CPU cores available: {num_workers}")
    
    simulation_sizes = [100000, 500000, 1000000, 2000000]
    
    results = []
    for size in simulation_sizes:
        try:
            result = run_benchmark(size, num_workers)
            results.append(result)
        except Exception as e:
            print(f"Error with {size} simulations: {e}")
    
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"{'Simulations':>12} {'Orig Time':>10} {'Opt Time':>10} {'Speedup':>8} {'Data Red':>10}")
    print("-" * 60)
    for r in results:
        print(f"{r['num_simulations']:>12,} {r['original_time']:>9.3f}s {r['optimized_time']:>9.3f}s {r['speedup']:>7.2f}x {r['data_reduction']:>9.1f}%")
    
    if len(results) > 1:
        fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 5))
        
        sizes = [r['num_simulations'] for r in results]
        
        ax1.plot(sizes, [r['original_time'] for r in results], 'o-', label='Original', linewidth=2)
        ax1.plot(sizes, [r['optimized_time'] for r in results], 's-', label='Optimized', linewidth=2)
        ax1.set_xlabel('Number of Simulations')
        ax1.set_ylabel('Time (seconds)')
        ax1.set_title('Performance Comparison')
        ax1.legend()
        ax1.grid(True, alpha=0.3)
        
        ax2.plot(sizes, [r['speedup'] for r in results], 'o-', color='green', linewidth=2)
        ax2.set_xlabel('Number of Simulations')
        ax2.set_ylabel('Speedup (x)')
        ax2.set_title('Speedup Factor')
        ax2.axhline(y=1, color='red', linestyle='--', alpha=0.5)
        ax2.grid(True, alpha=0.3)
        
        plt.tight_layout()
        plt.savefig('performance_benchmark.png', dpi=150)
        print(f"\nBenchmark plot saved to: performance_benchmark.png")

if __name__ == "__main__":
    main()
