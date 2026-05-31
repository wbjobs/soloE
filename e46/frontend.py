import streamlit as st
import httpx
import matplotlib.pyplot as plt
import numpy as np
import time
from mpl_toolkits.mplot3d import Axes3D
import seaborn as sns

st.set_page_config(
    page_title="Monte Carlo期权定价 & 波动率校准",
    page_icon="📈",
    layout="wide",
    initial_sidebar_state="expanded"
)

st.title("📊 Monte Carlo期权定价 & 波动率校准工具")

BACKEND_URL = "http://localhost:8000"

tab1, tab2 = st.tabs(["🎯 期权定价", "📉 波动率校准"])

with tab1:
    col1, col2 = st.columns([1, 2])

    with col1:
        st.subheader("期权参数")
        
        S = st.number_input("标的资产价格 (S)", value=100.0, min_value=0.01, step=1.0)
        K = st.number_input("行权价格 (K)", value=100.0, min_value=0.01, step=1.0)
        T = st.number_input("到期时间 (年)", value=1.0, min_value=0.01, step=0.1)
        r = st.number_input("无风险利率 (%)", value=5.0, min_value=0.0, step=0.1) / 100
        sigma = st.number_input("波动率 (%)", value=20.0, min_value=0.0, step=1.0) / 100
        option_type = st.selectbox("期权类型", ["看涨期权 (Call)", "看跌期权 (Put)"])
        num_simulations = st.selectbox(
            "模拟次数",
            [10000, 100000, 500000, 1000000, 2000000],
            index=3
        )
        
        option_type_param = "call" if "Call" in option_type else "put"
        
        calculate_button = st.button("开始计算", type="primary", use_container_width=True)

    with col2:
        if calculate_button:
            progress_bar = st.progress(0)
            status_text = st.empty()
            
            status_text.text("正在连接后端服务...")
            progress_bar.progress(10)
            
            try:
                start_time = time.time()
                
                with httpx.Client(timeout=300) as client:
                    status_text.text("正在进行Monte Carlo模拟...")
                    progress_bar.progress(30)
                    
                    response = client.post(
                        f"{BACKEND_URL}/price-option",
                        json={
                            "S": S,
                            "K": K,
                            "T": T,
                            "r": r,
                            "sigma": sigma,
                            "option_type": option_type_param,
                            "num_simulations": num_simulations
                        }
                    )
                    
                    progress_bar.progress(80)
                    status_text.text("正在处理结果...")
                    
                    if response.status_code == 200:
                        result = response.json()
                        elapsed_time = time.time() - start_time
                        
                        progress_bar.progress(100)
                        status_text.text(f"计算完成! 耗时: {elapsed_time:.2f}秒")
                        
                        st.success("✅ 计算完成!")
                        
                        st.subheader("💰 期权定价结果")
                        
                        metric_col1, metric_col2, metric_col3, metric_col4 = st.columns(4)
                        
                        with metric_col1:
                            st.metric(
                                "MC模拟价格",
                                f"${result['option_price']:.4f}"
                            )
                        
                        with metric_col2:
                            st.metric(
                                "Black-Scholes价格",
                                f"${result['bs_price']:.4f}"
                            )
                        
                        with metric_col3:
                            st.metric(
                                "价格差异",
                                f"{abs(result['option_price'] - result['bs_price']) / result['bs_price'] * 100:.2f}%"
                            )
                        
                        with metric_col4:
                            st.metric(
                                "计算时间",
                                f"{elapsed_time:.2f}秒"
                            )
                        
                        if 'data_transfer_size' in result:
                            st.info(f"📊 数据传输优化: {result['data_transfer_size']}")
                        
                        st.subheader("📐 希腊值 (Greeks)")
                        
                        greek_col1, greek_col2, greek_col3, greek_col4 = st.columns(4)
                        greeks = result['greeks']
                        
                        with greek_col1:
                            st.metric("Delta", f"{greeks['delta']:.4f}")
                            st.caption("价格对标的资产价格的一阶导数")
                        
                        with greek_col2:
                            st.metric("Gamma", f"{greeks['gamma']:.4f}")
                            st.caption("价格对标的资产价格的二阶导数")
                        
                        with greek_col3:
                            st.metric("Vega", f"{greeks['vega']:.4f}")
                            st.caption("价格对波动率的导数")
                        
                        with greek_col4:
                            st.metric("Theta", f"{greeks['theta']:.4f}")
                            st.caption("价格对时间的导数(日)")
                        
                        st.subheader("📈 收敛曲线")
                        
                        convergence = np.array(result['convergence'])
                        fig1, ax1 = plt.subplots(figsize=(10, 4))
                        x = np.linspace(num_simulations // 100, num_simulations, len(convergence))
                        ax1.plot(x, convergence, linewidth=2, color='#1f77b4', label='MC模拟价格')
                        ax1.axhline(y=result['bs_price'], color='red', linestyle='--', 
                                   label=f'Black-Scholes: ${result["bs_price"]:.4f}')
                        ax1.set_xlabel('模拟次数')
                        ax1.set_ylabel('期权价格')
                        ax1.set_title('期权价格收敛曲线')
                        ax1.legend()
                        ax1.grid(True, alpha=0.3)
                        st.pyplot(fig1)
                        
                        st.subheader("📊 标的资产到期价格分布")
                        
                        price_dist = np.array(result['price_distribution'])
                        fig2, ax2 = plt.subplots(figsize=(10, 4))
                        n, bins, patches = ax2.hist(price_dist, bins=50, density=True, 
                                                   alpha=0.7, color='#2ca02c', edgecolor='black')
                        ax2.axvline(x=K, color='red', linestyle='--', linewidth=2, 
                                   label=f'行权价: ${K}')
                        ax2.axvline(x=S, color='blue', linestyle='--', linewidth=2, 
                                   label=f'当前价格: ${S}')
                        ax2.set_xlabel('到期价格')
                        ax2.set_ylabel('概率密度')
                        ax2.set_title('标的资产到期价格分布')
                        ax2.legend()
                        ax2.grid(True, alpha=0.3)
                        st.pyplot(fig2)
                        
                        st.subheader("📋 统计信息")
                        stats_col1, stats_col2, stats_col3 = st.columns(3)
                        
                        with stats_col1:
                            st.metric("到期价格均值", f"${np.mean(price_dist):.4f}")
                        
                        with stats_col2:
                            st.metric("到期价格标准差", f"${np.std(price_dist):.4f}")
                        
                        with stats_col3:
                            st.metric("95%置信区间", 
                                     f"(${np.percentile(price_dist, 2.5):.2f}, ${np.percentile(price_dist, 97.5):.2f})")
                    
                    else:
                        st.error(f"❌ 后端服务错误: {response.status_code}")
                        st.json(response.json())
                        
            except Exception as e:
                st.error(f"❌ 连接错误: {str(e)}")
                st.info("请确保后端服务正在运行 (python backend.py)")
        else:
            st.info("👈 请在左侧输入参数并点击'开始计算'按钮")
            
            st.subheader("📖 使用说明")
            st.markdown("""
            1. **标的资产价格 (S)**: 当前标的资产的市场价格
            2. **行权价格 (K)**: 期权合约约定的执行价格
            3. **到期时间 (T)**: 期权距离到期的时间(年)
            4. **无风险利率 (r)**: 年化无风险利率
            5. **波动率 (sigma)**: 标的资产价格的年化波动率
            6. **期权类型**: 选择看涨或看跌期权
            
            **计算特性**:
            - 使用Geometric Brownian Motion模拟价格路径
            - 自动利用所有CPU核心进行并行计算
            - 支持最多200万次模拟
            - 实时显示收敛曲线和价格分布
            """)

with tab2:
    col1, col2 = st.columns([1, 2])
    
    with col1:
        st.subheader("📤 历史波动率校准")
        
        st.markdown("#### 1. 上传历史价格数据")
        uploaded_file = st.file_uploader("上传CSV文件 (包含每日收盘价)", type="csv")
        
        historical_vol = None
        if uploaded_file:
            try:
                with httpx.Client(timeout=60) as client:
                    with st.spinner("正在计算历史波动率..."):
                        files = {"file": (uploaded_file.name, uploaded_file.getvalue(), "text/csv")}
                        response = client.post(f"{BACKEND_URL}/calculate-historical-volatility", files=files)
                        
                        if response.status_code == 200:
                            hist_result = response.json()
                            historical_vol = hist_result['historical_volatility']
                            
                            st.success("✅ 历史波动率计算完成!")
                            st.metric("历史波动率", f"{historical_vol * 100:.2f}%")
                            st.caption(f"基于 {hist_result['num_days']} 天数据, 年化因子252天")
                            
                            with st.expander("查看最近30天价格数据"):
                                prices = hist_result['prices']
                                fig_price, ax_price = plt.subplots(figsize=(8, 3))
                                ax_price.plot(range(len(prices)), prices, 'b-', linewidth=1.5)
                                ax_price.set_title('最近30天收盘价')
                                ax_price.set_xlabel('交易日')
                                ax_price.set_ylabel('价格')
                                ax_price.grid(True, alpha=0.3)
                                st.pyplot(fig_price)
                        else:
                            st.error(f"❌ 计算失败: {response.text}")
            except Exception as e:
                st.error(f"❌ 处理错误: {str(e)}")
        
        st.markdown("---")
        st.markdown("#### 2. 隐含波动率计算")
        
        S_iv = st.number_input("标的资产价格 (S)", value=100.0, min_value=0.01, step=1.0, key="iv_S")
        K_iv = st.number_input("行权价格 (K)", value=100.0, min_value=0.01, step=1.0, key="iv_K")
        T_iv = st.number_input("到期时间 (年)", value=1.0, min_value=0.01, step=0.1, key="iv_T")
        r_iv = st.number_input("无风险利率 (%)", value=5.0, min_value=0.0, step=0.1, key="iv_r") / 100
        option_market_price = st.number_input("期权市场价格 ($)", value=10.0, min_value=0.01, step=0.1)
        iv_option_type = st.selectbox("期权类型", ["看涨期权 (Call)", "看跌期权 (Put)"], key="iv_type")
        
        calculate_iv = st.button("计算隐含波动率", type="primary", use_container_width=True)
        
        implied_vol = None
        if calculate_iv:
            try:
                with httpx.Client(timeout=60) as client:
                    iv_type_param = "call" if "Call" in iv_option_type else "put"
                    response = client.post(
                        f"{BACKEND_URL}/calculate-implied-volatility",
                        json={
                            "S": S_iv,
                            "K": K_iv,
                            "T": T_iv,
                            "r": r_iv,
                            "option_price": option_market_price,
                            "option_type": iv_type_param
                        }
                    )
                    
                    if response.status_code == 200:
                        iv_result = response.json()
                        implied_vol = iv_result['implied_volatility']
                        
                        st.success("✅ 隐含波动率计算完成!")
                        st.metric("隐含波动率 (Newton-Raphson)", f"{implied_vol * 100:.2f}%")
                        
                        if historical_vol:
                            vol_diff = implied_vol - historical_vol
                            diff_pct = vol_diff / historical_vol * 100
                            delta_color = "normal" if abs(diff_pct) < 10 else "off"
                            st.metric("隐含 - 历史波动率差", 
                                     f"{vol_diff * 100:.2f}% ({diff_pct:+.1f}%)",
                                     delta_color=delta_color)
                            
                            if vol_diff > 0:
                                st.warning("⚠️ 隐含波动率高于历史波动率 - 期权可能被高估")
                            else:
                                st.info("💡 隐含波动率低于历史波动率 - 期权可能被低估")
                    else:
                        st.error(f"❌ 计算失败: {response.text}")
            except Exception as e:
                st.error(f"❌ 处理错误: {str(e)}")
        
        st.markdown("---")
        st.markdown("#### 3. 波动率曲面参数")
        
        spot_price = st.number_input("标的当前价格", value=100.0, key="surface_S")
        surface_r = st.number_input("无风险利率 (%)", value=5.0, key="surface_r") / 100
        
        min_strike_pct = st.slider("最低行权价 (%)", 70, 90, 80)
        max_strike_pct = st.slider("最高行权价 (%)", 110, 130, 120)
        num_strikes = st.slider("行权价数量", 5, 15, 9)
        
        min_maturity = st.slider("最短到期 (月)", 1, 3, 1)
        max_maturity = st.slider("最长到期 (月)", 6, 24, 12)
        num_maturities = st.slider("到期时间数量", 4, 10, 6)
        
        generate_surface = st.button("生成波动率曲面", type="secondary", use_container_width=True)
    
    with col2:
        if generate_surface:
            try:
                with st.spinner("正在生成波动率曲面..."):
                    strikes = np.linspace(spot_price * min_strike_pct / 100, 
                                         spot_price * max_strike_pct / 100, 
                                         num_strikes).tolist()
                    maturities = np.linspace(min_maturity / 12, 
                                            max_maturity / 12, 
                                            num_maturities).tolist()
                    
                    with httpx.Client(timeout=60) as client:
                        response = client.post(
                            f"{BACKEND_URL}/volatility-surface",
                            json={
                                "S": spot_price,
                                "r": surface_r,
                                "strikes": strikes,
                                "maturities": maturities,
                                "option_type": "call"
                            }
                        )
                        
                        if response.status_code == 200:
                            surface_result = response.json()
                            vol_surface = np.array(surface_result['volatility_surface'])
                            
                            st.success("✅ 波动率曲面生成完成!")
                            
                            X, Y = np.meshgrid(maturities, strikes)
                            Z = vol_surface
                            
                            col_fig1, col_fig2 = st.columns(2)
                            
                            with col_fig1:
                                st.subheader("🔥 波动率热力图")
                                fig_heat, ax_heat = plt.subplots(figsize=(10, 8))
                                sns.heatmap(Z, 
                                           xticklabels=[f"{m*12:.0f}月" for m in maturities],
                                           yticklabels=[f"{k:.0f}" for k in strikes],
                                           cmap='RdYlGn_r',
                                           annot=True,
                                           fmt='.1f',
                                           cbar_kws={'label': '波动率 (%)'},
                                           ax=ax_heat)
                                ax_heat.set_xlabel('到期时间')
                                ax_heat.set_ylabel('行权价格')
                                ax_heat.set_title('波动率微笑热力图')
                                st.pyplot(fig_heat)
                            
                            with col_fig2:
                                st.subheader("📈 波动率微笑曲线")
                                fig_smile, ax_smile = plt.subplots(figsize=(10, 6))
                                for i, T in enumerate(maturities):
                                    ax_smile.plot(strikes, Z[:, i], 'o-', linewidth=2, 
                                                 markersize=4, label=f'{T*12:.0f}月')
                                ax_smile.axvline(x=spot_price, color='red', linestyle='--', 
                                               linewidth=2, label=f'ATM: {spot_price:.0f}')
                                ax_smile.set_xlabel('行权价格')
                                ax_smile.set_ylabel('波动率 (%)')
                                ax_smile.set_title('波动率微笑 (Volatility Smile)')
                                ax_smile.legend()
                                ax_smile.grid(True, alpha=0.3)
                                st.pyplot(fig_smile)
                            
                            st.subheader("🌐 3D波动率曲面")
                            fig_3d = plt.figure(figsize=(12, 8))
                            ax_3d = fig_3d.add_subplot(111, projection='3d')
                            surf = ax_3d.plot_surface(X * 12, Y, Z, 
                                                     cmap='RdYlGn_r',
                                                     linewidth=0.5,
                                                     antialiased=True,
                                                     alpha=0.8)
                            ax_3d.set_xlabel('到期时间 (月)')
                            ax_3d.set_ylabel('行权价格')
                            ax_3d.set_zlabel('波动率 (%)')
                            ax_3d.set_title('3D波动率曲面')
                            fig_3d.colorbar(surf, shrink=0.5, aspect=5, label='波动率 (%)')
                            st.pyplot(fig_3d)
                            
                            if historical_vol:
                                st.subheader("📊 波动率对比分析")
                                avg_iv = np.mean(vol_surface) / 100
                                comparison_col1, comparison_col2, comparison_col3 = st.columns(3)
                                
                                with comparison_col1:
                                    st.metric("平均隐含波动率", f"{avg_iv * 100:.2f}%")
                                
                                with comparison_col2:
                                    st.metric("历史波动率", f"{historical_vol * 100:.2f}%")
                                
                                with comparison_col3:
                                    premium = (avg_iv - historical_vol) / historical_vol * 100
                                    st.metric("波动率溢价", f"{premium:+.2f}%")
                                
                                if premium > 0:
                                    st.warning(f"⚠️ 当前市场波动率溢价 {premium:.2f}%, 隐含波动率高于历史水平")
                                else:
                                    st.info(f"💡 当前市场波动率折价 {-premium:.2f}%, 隐含波动率低于历史水平")
                        else:
                            st.error(f"❌ 生成失败: {response.text}")
            except Exception as e:
                st.error(f"❌ 处理错误: {str(e)}")
        else:
            st.info("👈 上传历史数据并设置参数, 点击'生成波动率曲面'按钮")
            
            st.subheader("📖 波动率校准说明")
            st.markdown("""
            **历史波动率**:
            - 基于标的资产过去一年的每日收盘价计算
            - 使用对数收益率的标准差年化 (年化因子252天)
            - 代表已实现的波动率水平
            
            **隐含波动率**:
            - 使用Newton-Raphson迭代法反向求解Black-Scholes公式
            - 代表市场对未来波动率的预期
            - 可用于判断期权的估值水平
            
            **波动率曲面**:
            - 展示不同行权价和到期时间对应的隐含波动率
            - 通常呈现"波动率微笑"形态 (ATM波动率最低)
            - 可用于期权定价和套利机会识别
            
            **CSV文件格式要求**:
            - 需包含日期和收盘价列
            - 列名包含 'Close', 'close', 'Price', 'price' 等关键字
            - 至少需要2个数据点
            """)

st.markdown("---")
st.caption("Monte Carlo期权定价 & 波动率校准工具 | FastAPI + Streamlit + NumPy")
