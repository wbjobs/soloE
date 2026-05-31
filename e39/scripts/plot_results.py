#!/usr/bin/env python3
import pandas as pd
import matplotlib.pyplot as plt
import numpy as np

def read_benchmark_csv(csv_file):
    """Read multi-section benchmark CSV"""
    sections = {}
    current_section = None
    
    with open(csv_file, 'r') as f:
        lines = f.readlines()
    
    data_lines = []
    for line in lines:
        line = line.strip()
        if line.startswith('#'):
            if data_lines and current_section:
                sections[current_section] = pd.DataFrame(data_lines[1:], columns=data_lines[0].split(','))
            current_section = line[2:].strip()
            data_lines = []
        elif line and current_section:
            data_lines.append(line)
    
    if data_lines and current_section:
        sections[current_section] = pd.DataFrame(data_lines[1:], columns=data_lines[0].split(','))
    
    return sections

def plot_comparison(csv_file='benchmark_results.csv'):
    sections = read_benchmark_csv(csv_file)
    df = sections.get('Benchmark Results', pd.read_csv(csv_file))
    df_predict = sections.get('Algorithm Predictions', None)
    df_stats = sections.get('Data Statistics', None)

    algorithms = df['algorithm'].values
    compression_ratios = pd.to_numeric(df['compression_ratio']).values
    compression_speeds = pd.to_numeric(df['compression_speed_mbs']).values
    decompression_speeds = pd.to_numeric(df['decompression_speed_mbs']).values
    peak_memory = pd.to_numeric(df['peak_memory_bytes']).values / 1024

    fig = plt.figure(figsize=(16, 12))
    fig.suptitle('Time Series Compression Algorithms Comparison', fontsize=16, fontweight='bold')

    gs = fig.add_gridspec(3, 2, hspace=0.3, wspace=0.3)
    colors = ['#3498db', '#e74c3c', '#2ecc71']

    ax0 = fig.add_subplot(gs[0, :])
    if df_stats is not None:
        stats_text = "Data Statistics:\n"
        cv_val = float(df_stats.loc[df_stats.iloc[:,0] == 'coefficient_of_variation'].iloc[0,1])
        data_points = int(float(df_stats.loc[df_stats.iloc[:,0] == 'data_points'].iloc[0,1]))
        zero_ratio = float(df_stats.loc[df_stats.iloc[:,0] == 'zero_ratio'].iloc[0,1]) * 100
        repeat_ratio = float(df_stats.loc[df_stats.iloc[:,0] == 'repeat_ratio'].iloc[0,1]) * 100
        
        stats_text += f"{data_points:,} points  |  CV = {cv_val:.4f}  |  Zero = {zero_ratio:.1f}%  |  Repeat = {repeat_ratio:.1f}%"
        ax0.text(0.5, 0.5, stats_text, ha='center', va='center', fontsize=12, 
                bbox=dict(boxstyle='round,pad=1', facecolor='#f0f0f0', alpha=0.8))
    ax0.set_title('Data Profile', fontsize=12, fontweight='bold')
    ax0.axis('off')

    ax1 = fig.add_subplot(gs[1, 0])
    x = np.arange(len(algorithms))
    width = 0.35
    
    bars1_actual = ax1.bar(x - width/2, compression_ratios, width, label='Actual', color=colors)
    ax1.set_title('Compression Ratio (higher is better)', fontsize=11, fontweight='bold')
    ax1.set_ylabel('Compression Ratio', fontsize=9)
    ax1.grid(axis='y', alpha=0.3)
    ax1.set_xticks(x)
    ax1.set_xticklabels(algorithms, rotation=15, ha='right')
    
    if df_predict is not None:
        pred_ratios = []
        for algo in algorithms:
            pred_row = df_predict[df_predict['algorithm'] == algo]
            if len(pred_row) > 0:
                pred_ratios.append(float(pred_row.iloc[0]['predicted_ratio']))
            else:
                pred_ratios.append(0)
        bars1_pred = ax1.bar(x + width/2, pred_ratios, width, label='Predicted', 
                            color=[c + '80' for c in colors], edgecolor='gray', linestyle='--')
        
        for i, (actual, pred) in enumerate(zip(compression_ratios, pred_ratios)):
            err = abs(actual - pred) / pred * 100
            ax1.annotate(f'{err:.1f}% err', xy=(x[i], max(actual, pred)), 
                        ha='center', va='bottom', fontsize=8)
    
    ax1.legend(fontsize=9)

    ax2 = fig.add_subplot(gs[1, 1])
    bars2 = ax2.bar(algorithms, compression_speeds, color=colors, width=0.6)
    ax2.set_title('Compression Speed (higher is better)', fontsize=11, fontweight='bold')
    ax2.set_ylabel('Speed (MB/s)', fontsize=9)
    ax2.grid(axis='y', alpha=0.3)
    ax2.tick_params(axis='x', rotation=15)
    for bar in bars2:
        height = bar.get_height()
        ax2.text(bar.get_x() + bar.get_width()/2., height,
                f'{height:.1f}',
                ha='center', va='bottom', fontsize=9)

    ax3 = fig.add_subplot(gs[2, 0])
    bars3 = ax3.bar(algorithms, decompression_speeds, color=colors, width=0.6)
    ax3.set_title('Decompression Speed (higher is better)', fontsize=11, fontweight='bold')
    ax3.set_ylabel('Speed (MB/s)', fontsize=9)
    ax3.grid(axis='y', alpha=0.3)
    ax3.tick_params(axis='x', rotation=15)
    for bar in bars3:
        height = bar.get_height()
        ax3.text(bar.get_x() + bar.get_width()/2., height,
                f'{height:.1f}',
                ha='center', va='bottom', fontsize=9)

    ax4 = fig.add_subplot(gs[2, 1])
    if df_predict is not None:
        recommendations = []
        for _, row in df_predict.iterrows():
            label = f"{row['algorithm']}\n({row['reason'][:30]})"
            recommendations.append((label, float(row['predicted_ratio'])))
        
        rec_labels, rec_scores = zip(*sorted(recommendations, key=lambda x: -x[1]))
        y_pos = np.arange(len(rec_labels))
        bars_rec = ax4.barh(y_pos, rec_scores, color=[colors[i] for i in range(len(rec_labels))])
        ax4.set_title('Algorithm Recommendations', fontsize=11, fontweight='bold')
        ax4.set_xlabel('Predicted Compression Ratio', fontsize=9)
        ax4.set_yticks(y_pos)
        ax4.set_yticklabels(rec_labels, fontsize=8)
        ax4.grid(axis='x', alpha=0.3)
        
        for i, (bar, score) in enumerate(zip(bars_rec, rec_scores)):
            ax4.text(score, bar.get_y() + bar.get_height()/2, 
                    f' {score:.2f}:1 {("★ BEST" if i == 0 else "")}',
                    va='center', fontsize=9, fontweight='bold' if i == 0 else 'normal')

    plt.savefig('compression_comparison.png', dpi=300, bbox_inches='tight')
    print("Chart saved to compression_comparison.png")
    plt.show()

def plot_radar(csv_file='benchmark_results.csv'):
    sections = read_benchmark_csv(csv_file)
    df = sections.get('Benchmark Results', pd.read_csv(csv_file))

    categories = ['Compression Ratio', 'Compression Speed', 'Decompression Speed', 'Memory Efficiency']
    N = len(categories)

    angles = [n / float(N) * 2 * np.pi for n in range(N)]
    angles += angles[:1]

    fig, ax = plt.subplots(figsize=(10, 10), subplot_kw=dict(projection='polar'))

    colors = ['#3498db', '#e74c3c', '#2ecc71']
    algorithms = df['algorithm'].values

    max_ratio = df['compression_ratio'].max()
    max_comp_speed = df['compression_speed_mbs'].max()
    max_decomp_speed = df['decompression_speed_mbs'].max()
    min_memory = df['peak_memory_bytes'].min()

    for idx, algo in enumerate(algorithms):
        row = df[df['algorithm'] == algo].iloc[0]

        values = [
            row['compression_ratio'] / max_ratio,
            row['compression_speed_mbs'] / max_comp_speed,
            row['decompression_speed_mbs'] / max_decomp_speed,
            min_memory / row['peak_memory_bytes']
        ]
        values += values[:1]

        ax.plot(angles, values, 'o-', linewidth=2, label=algo, color=colors[idx])
        ax.fill(angles, values, alpha=0.25, color=colors[idx])

    ax.set_xticks(angles[:-1])
    ax.set_xticklabels(categories, fontsize=11, fontweight='bold')
    ax.set_ylim(0, 1)
    ax.set_title('Algorithm Performance Radar Chart (normalized)', size=14, fontweight='bold', y=1.1)
    ax.legend(loc='upper right', bbox_to_anchor=(1.3, 1.1))

    plt.tight_layout()
    plt.savefig('radar_comparison.png', dpi=300, bbox_inches='tight')
    print("Radar chart saved to radar_comparison.png")
    plt.show()

if __name__ == '__main__':
    import sys
    csv_file = sys.argv[1] if len(sys.argv) > 1 else 'benchmark_results.csv'
    plot_comparison(csv_file)
    plot_radar(csv_file)
