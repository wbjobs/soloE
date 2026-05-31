import streamlit as st
import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import requests
import io
import os
import sys

API_BASE_URL = "http://localhost:8000"

st.set_page_config(
    page_title="实时股票回测系统",
    page_icon="📈",
    layout="wide"
)

st.title("📈 实时股票回测系统")


def upload_data_page():
    st.header("📂 上传历史数据")
    
    col1, col2 = st.columns(2)
    
    with col1:
        symbol = st.text_input("股票代码", value="AAPL", help="输入股票代码，如AAPL、MSFT等")
    
    with col2:
        uploaded_file = st.file_uploader("上传CSV文件", type="csv", help="CSV文件需包含timestamp, open, high, low, close, volume列")
    
    if uploaded_file is not None and symbol:
        df = pd.read_csv(uploaded_file)
        st.write("数据预览:")
        st.dataframe(df.head(), use_container_width=True)
        
        if st.button("上传数据", type="primary"):
            with st.spinner("上传数据中..."):
                uploaded_file.seek(0)
                files = {"file": uploaded_file.getvalue()}
                response = requests.post(f"{API_BASE_URL}/upload/{symbol}", files=files)
                
                if response.status_code == 200:
                    st.success(f"✅ {symbol} 数据上传成功!")
                    if 'uploaded_symbols' in st.session_state:
                        del st.session_state['uploaded_symbols']
                else:
                    st.error(f"❌ 上传失败: {response.json().get('detail', '未知错误')}")


def backtest_page():
    st.header("⚙️ 回测配置")
    
    response = requests.get(f"{API_BASE_URL}/uploaded-symbols")
    uploaded_symbols = response.json().get("symbols", []) if response.status_code == 200 else []
    
    if not uploaded_symbols:
        st.warning("⚠️ 暂无上传的数据，请先在「上传数据」页面上传历史数据")
        return
    
    col1, col2, col3 = st.columns(3)
    
    with col1:
        initial_capital = st.number_input("初始资金 (¥)", value=100000.0, min_value=1000.0, step=10000.0)
    
    with col2:
        selected_symbols = st.multiselect("选择股票", options=uploaded_symbols, default=[uploaded_symbols[0]] if uploaded_symbols else [])
    
    with col3:
        strategy_options = [
            ("移动平均线金叉死叉策略 (MA Cross)", "ma_cross"),
            ("RSI策略", "rsi")
        ]
        strategy_display = st.selectbox("选择策略", options=[opt[0] for opt in strategy_options])
        strategy_type = [opt[1] for opt in strategy_options if opt[0] == strategy_display][0]
    
    strategy_params = {}
    
    if strategy_type == "ma_cross":
        col_short, col_long = st.columns(2)
        with col_short:
            strategy_params["short_window"] = st.number_input("短期均线周期", value=5, min_value=1, max_value=50)
        with col_long:
            strategy_params["long_window"] = st.number_input("长期均线周期", value=20, min_value=1, max_value=200)
    
    elif strategy_type == "rsi":
        col_period, col_ob, col_os = st.columns(3)
        with col_period:
            strategy_params["period"] = st.number_input("RSI周期", value=14, min_value=2, max_value=50)
        with col_ob:
            strategy_params["overbought"] = st.number_input("超买阈值", value=70.0, min_value=50.0, max_value=90.0)
        with col_os:
            strategy_params["oversold"] = st.number_input("超卖阈值", value=30.0, min_value=10.0, max_value=50.0)
    
    st.subheader("交易成本设置")
    col_slip, col_comm = st.columns(2)
    
    with col_slip:
        slippage_bps = st.number_input("滑点 (基点)", value=5.0, min_value=0.0, max_value=100.0, help="1基点=0.01%")
    
    with col_comm:
        commission_rate = st.number_input("手续费率 (%)", value=0.1, min_value=0.0, max_value=1.0, step=0.01)
        min_commission = st.number_input("最低手续费 (¥)", value=1.0, min_value=0.0)
    
    run_backtest = st.button("🚀 运行回测", type="primary", use_container_width=True)
    
    if run_backtest and selected_symbols:
        config = {
            "strategy_type": strategy_type,
            "initial_capital": initial_capital,
            "symbols": selected_symbols,
            "strategy_params": strategy_params,
            "slippage_type": "fixed",
            "slippage_params": {"bps": slippage_bps},
            "commission_type": "percentage",
            "commission_params": {"rate": commission_rate / 100.0, "min": min_commission}
        }
        
        with st.spinner("回测运行中..."):
            response = requests.post(f"{API_BASE_URL}/backtest", json=config)
            
            if response.status_code == 200:
                results = response.json()
                st.session_state["backtest_results"] = results
                st.success("✅ 回测完成!")
                
                display_results(results)
            else:
                st.error(f"❌ 回测失败: {response.json().get('detail', '未知错误')}")
    
    elif 'backtest_results' in st.session_state:
        display_results(st.session_state["backtest_results"])


def display_results(results):
    st.header("📊 回测结果")
    
    perf = results["results"]["performance"]
    price_data = results.get("price_data", {})
    
    col1, col2, col3, col4 = st.columns(4)
    
    with col1:
        total_return = perf.get('total_return', 0) * 100
        st.metric("总收益率", f"{total_return:.2f}%", delta=None)
    
    with col2:
        max_drawdown = perf.get('max_drawdown', 0) * 100
        st.metric("最大回撤", f"{max_drawdown:.2f}%", delta=None)
    
    with col3:
        sharpe = perf.get('sharpe_ratio', 0)
        st.metric("夏普比率", f"{sharpe:.2f}", delta=None)
    
    with col4:
        final_equity = perf.get('final_equity', 0)
        st.metric("最终权益", f"¥{final_equity:,.2f}", delta=None)
    
    col5, col6, col7, col8 = st.columns(4)
    
    with col5:
        annual_return = perf.get('annualized_return', 0) * 100
        st.metric("年化收益率", f"{annual_return:.2f}%", delta=None)
    
    with col6:
        win_rate = perf.get('win_rate', 0) * 100
        st.metric("胜率", f"{win_rate:.2f}%", delta=None)
    
    with col7:
        total_trades = perf.get('total_trades', 0)
        st.metric("交易次数", f"{total_trades}", delta=None)
    
    with col8:
        volatility = perf.get('volatility', 0) * 100
        st.metric("波动率", f"{volatility:.2f}%", delta=None)
    
    st.subheader("权益曲线")
    equity_df = pd.DataFrame(results["results"]["equity_curve"])
    if not equity_df.empty:
        fig = go.Figure()
        fig.add_trace(go.Scatter(
            x=equity_df['timestamp'],
            y=equity_df['total_equity'],
            mode='lines',
            name='总权益',
            line=dict(color='blue', width=2)
        ))
        
        peak = equity_df['total_equity'].expanding().max()
        fig.add_trace(go.Scatter(
            x=equity_df['timestamp'],
            y=peak,
            mode='lines',
            name='净值峰值',
            line=dict(color='green', width=1, dash='dash')
        ))
        
        fig.update_layout(
            title='权益曲线',
            xaxis_title='时间',
            yaxis_title='权益价值 (¥)',
            hovermode='x unified',
            height=400
        )
        st.plotly_chart(fig, use_container_width=True)
    
    st.subheader("价格走势与买卖点")
    
    trades_df = pd.DataFrame(results["results"]["trades"]) if results["results"]["trades"] else pd.DataFrame()
    
    for symbol, price_records in price_data.items():
        df_price = pd.DataFrame(price_records)
        
        symbol_trades = trades_df[trades_df['symbol'] == symbol] if not trades_df.empty else pd.DataFrame()
        
        fig = make_subplots(rows=2, cols=1, shared_xaxes=True, 
                           vertical_spacing=0.03, row_heights=[0.7, 0.3])
        
        fig.add_trace(go.Candlestick(
            x=df_price['timestamp'],
            open=df_price['open'],
            high=df_price['high'],
            low=df_price['low'],
            close=df_price['close'],
            name=f'{symbol} 价格'
        ), row=1, col=1)
        
        if not symbol_trades.empty:
            buy_trades = symbol_trades[symbol_trades['quantity'] > 0]
            sell_trades = symbol_trades[symbol_trades['quantity'] < 0]
            
            if not buy_trades.empty:
                fig.add_trace(go.Scatter(
                    x=buy_trades['timestamp'],
                    y=buy_trades['price'],
                    mode='markers',
                    marker=dict(symbol='triangle-up', size=12, color='green', line=dict(width=2, color='darkgreen')),
                    name='买入',
                    showlegend=True
                ), row=1, col=1)
            
            if not sell_trades.empty:
                fig.add_trace(go.Scatter(
                    x=sell_trades['timestamp'],
                    y=sell_trades['price'],
                    mode='markers',
                    marker=dict(symbol='triangle-down', size=12, color='red', line=dict(width=2, color='darkred')),
                    name='卖出',
                    showlegend=True
                ), row=1, col=1)
        
        fig.add_trace(go.Bar(
            x=df_price['timestamp'],
            y=df_price['volume'],
            name='成交量',
            marker_color='gray',
            opacity=0.5
        ), row=2, col=1)
        
        fig.update_layout(
            title=f'{symbol} 价格走势与买卖点',
            xaxis_title='时间',
            yaxis_title='价格 (¥)',
            hovermode='x unified',
            height=600
        )
        
        fig.update(layout_xaxis_rangeslider_visible=False)
        st.plotly_chart(fig, use_container_width=True)
    
    if not trades_df.empty:
        st.subheader("📋 交易记录")
        trades_df['买卖'] = trades_df['quantity'].apply(lambda x: '买入' if x > 0 else '卖出')
        trades_df['数量'] = trades_df['quantity'].abs()
        display_df = trades_df[['timestamp', 'symbol', '买卖', '数量', 'price', 'commission']].rename(
            columns={
                'timestamp': '时间',
                'symbol': '股票代码',
                'price': '价格',
                'commission': '手续费'
            }
        )
        st.dataframe(display_df, use_container_width=True)


def main():
    st.sidebar.title("📋 导航")
    
    page = st.sidebar.radio("选择页面", ["📂 上传数据", "⚙️ 回测配置"])
    
    if page == "📂 上传数据":
        upload_data_page()
    elif page == "⚙️ 回测配置":
        backtest_page()
    
    st.sidebar.divider()
    st.sidebar.markdown("### 📖 使用说明")
    st.sidebar.markdown("""
    1. 在「上传数据」页面上传股票历史数据CSV文件
    2. 在「回测配置」页面选择策略和参数
    3. 点击「运行回测」查看结果
    """)


if __name__ == "__main__":
    main()
