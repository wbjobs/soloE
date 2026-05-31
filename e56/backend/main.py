from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import os
import shutil
import tempfile
import json

from .engine.backtest import BacktestEngine
from .engine.memory_monitor import get_memory_monitor
from .engine.parameter_optimizer import ParameterOptimizer
from .strategies.ma_cross import MovingAverageCrossStrategy
from .strategies.rsi_strategy import RSIStrategy


app = FastAPI(title="实时股票回测系统API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ParameterRangeConfig(BaseModel):
    name: str
    min_value: float
    max_value: float
    step: float = 1.0
    value_type: str = "int"


class OptimizationConfig(BaseModel):
    strategy_type: str
    initial_capital: float = 100000.0
    symbols: List[str]
    parameter_ranges: List[ParameterRangeConfig]
    optimization_metric: str = "sharpe_ratio"
    slippage_type: str = "fixed"
    slippage_params: Dict[str, Any] = {"bps": 5.0}
    commission_type: str = "percentage"
    commission_params: Dict[str, Any] = {"rate": 0.001, "min": 1.0}
    max_workers: Optional[int] = None


class BacktestConfig(BaseModel):
    strategy_type: str
    initial_capital: float = 100000.0
    symbols: List[str]
    strategy_params: Dict[str, Any] = {}
    slippage_type: str = "fixed"
    slippage_params: Dict[str, Any] = {"bps": 5.0}
    commission_type: str = "percentage"
    commission_params: Dict[str, Any] = {"rate": 0.001, "min": 1.0}
    use_streaming: bool = False
    max_queue_size: int = 10000
    chunk_size: int = 10000


UPLOAD_DIR = tempfile.mkdtemp()


def convert_timestamps(data):
    if isinstance(data, list):
        return [convert_timestamps(item) for item in data]
    elif isinstance(data, dict):
        return {key: convert_timestamps(value) for key, value in data.items()}
    elif hasattr(data, 'isoformat'):
        return data.isoformat()
    else:
        return data


@app.get("/")
async def root():
    return {"message": "实时股票回测系统API", "version": "1.0"}


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


@app.post("/upload/{symbol}")
async def upload_data(symbol: str, file: UploadFile = File(...)):
    try:
        file_path = os.path.join(UPLOAD_DIR, f"{symbol}.csv")
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        return {
            "success": True,
            "symbol": symbol,
            "file_path": file_path,
            "message": f"数据文件 {symbol}.csv 上传成功"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/backtest")
async def run_backtest(config: BacktestConfig):
    try:
        engine = BacktestEngine(
            initial_capital=config.initial_capital,
            slippage_type=config.slippage_type,
            slippage_params=config.slippage_params,
            commission_type=config.commission_type,
            commission_params=config.commission_params,
            use_streaming=config.use_streaming,
            max_queue_size=config.max_queue_size,
            chunk_size=config.chunk_size,
            enable_memory_monitoring=True
        )
        
        if config.use_streaming:
            file_paths = {}
            for symbol in config.symbols:
                file_path = os.path.join(UPLOAD_DIR, f"{symbol}.csv")
                if not os.path.exists(file_path):
                    raise HTTPException(
                        status_code=400,
                        detail=f"股票 {symbol} 的数据文件不存在，请先上传"
                    )
                file_paths[symbol] = file_path
            
            if config.strategy_type == "ma_cross":
                strategy = MovingAverageCrossStrategy(
                    symbols=config.symbols,
                    short_window=config.strategy_params.get("short_window", 5),
                    long_window=config.strategy_params.get("long_window", 20)
                )
            elif config.strategy_type == "rsi":
                strategy = RSIStrategy(
                    symbols=config.symbols,
                    period=config.strategy_params.get("period", 14),
                    overbought=config.strategy_params.get("overbought", 70.0),
                    oversold=config.strategy_params.get("oversold", 30.0)
                )
            else:
                raise HTTPException(status_code=400, detail="不支持的策略类型")
            
            engine.set_strategy(strategy)
            results = engine.run_streaming(file_paths)
        else:
            for symbol in config.symbols:
                file_path = os.path.join(UPLOAD_DIR, f"{symbol}.csv")
                if not os.path.exists(file_path):
                    raise HTTPException(
                        status_code=400,
                        detail=f"股票 {symbol} 的数据文件不存在，请先上传"
                    )
                engine.load_data(file_path, symbol)
            
            if config.strategy_type == "ma_cross":
                strategy = MovingAverageCrossStrategy(
                    symbols=config.symbols,
                    short_window=config.strategy_params.get("short_window", 5),
                    long_window=config.strategy_params.get("long_window", 20)
                )
            elif config.strategy_type == "rsi":
                strategy = RSIStrategy(
                    symbols=config.symbols,
                    period=config.strategy_params.get("period", 14),
                    overbought=config.strategy_params.get("overbought", 70.0),
                    oversold=config.strategy_params.get("oversold", 30.0)
                )
            else:
                raise HTTPException(status_code=400, detail="不支持的策略类型")
            
            engine.set_strategy(strategy)
            results = engine.run()
        
        results = convert_timestamps(results)
        
        price_data = {}
        if not config.use_streaming:
            for symbol in config.symbols:
                df = engine.get_symbol_data(symbol)
                if df is not None:
                    price_data[symbol] = convert_timestamps(df.to_dict('records'))
        
        return {
            "success": True,
            "results": results,
            "price_data": price_data,
            "mode": "streaming" if config.use_streaming else "standard"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/strategies")
async def get_available_strategies():
    return {
        "strategies": [
            {
                "name": "ma_cross",
                "display_name": "移动平均线金叉死叉策略",
                "params": [
                    {"name": "short_window", "type": "int", "default": 5},
                    {"name": "long_window", "type": "int", "default": 20}
                ]
            },
            {
                "name": "rsi",
                "display_name": "RSI策略",
                "params": [
                    {"name": "period", "type": "int", "default": 14},
                    {"name": "overbought", "type": "float", "default": 70.0},
                    {"name": "oversold", "type": "float", "default": 30.0}
                ]
            }
        ]
    }


@app.get("/uploaded-symbols")
async def get_uploaded_symbols():
    try:
        symbols = []
        for filename in os.listdir(UPLOAD_DIR):
            if filename.endswith('.csv'):
                symbols.append(filename[:-4])
        return {"symbols": symbols}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/memory/stats")
async def get_memory_stats():
    try:
        monitor = get_memory_monitor()
        stats = monitor.get_memory_stats()
        return {
            "success": True,
            "stats": stats
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/memory/trend")
async def get_memory_trend(last_n: int = 100):
    try:
        monitor = get_memory_monitor()
        trend = monitor.get_memory_trend(last_n)
        return {
            "success": True,
            "trend": trend
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/memory/force-gc")
async def force_gc():
    try:
        monitor = get_memory_monitor()
        mem_before = monitor.get_current_memory()
        mem_after = monitor.force_gc()
        return {
            "success": True,
            "memory_before": mem_before,
            "memory_after": mem_after
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/optimize")
async def run_optimization(config: OptimizationConfig):
    try:
        for symbol in config.symbols:
            file_path = os.path.join(UPLOAD_DIR, f"{symbol}.csv")
            if not os.path.exists(file_path):
                raise HTTPException(
                    status_code=400,
                    detail=f"股票 {symbol} 的数据文件不存在，请先上传"
                )
        
        optimizer = ParameterOptimizer(
            strategy_type=config.strategy_type,
            data_dir=UPLOAD_DIR
        )
        
        for param_range in config.parameter_ranges:
            optimizer.add_parameter_range(
                name=param_range.name,
                min_value=param_range.min_value,
                max_value=param_range.max_value,
                step=param_range.step,
                value_type=param_range.value_type
            )
        
        optimizer.set_optimization_metric(config.optimization_metric)
        
        param_count = len(optimizer.generate_parameter_combinations())
        
        results = optimizer.run_optimization(
            symbols=config.symbols,
            initial_capital=config.initial_capital,
            slippage_type=config.slippage_type,
            slippage_params=config.slippage_params,
            commission_type=config.commission_type,
            commission_params=config.commission_params,
            max_workers=config.max_workers
        )
        
        return {
            "success": True,
            "message": f"参数优化完成，共测试 {param_count} 个参数组合",
            "results": results
        }
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/optimize/metrics")
async def get_optimization_metrics():
    return {
        "success": True,
        "metrics": [
            {"name": "sharpe_ratio", "display_name": "夏普比率", "higher_is_better": True},
            {"name": "total_return", "display_name": "总收益率", "higher_is_better": True},
            {"name": "annualized_return", "display_name": "年化收益率", "higher_is_better": True},
            {"name": "win_rate", "display_name": "胜率", "higher_is_better": True},
            {"name": "max_drawdown", "display_name": "最大回撤", "higher_is_better": False}
        ]
    }


@app.get("/optimize/strategies/{strategy_type}/parameters")
async def get_strategy_parameters(strategy_type: str):
    strategy_params = {
        "ma_cross": [
            {
                "name": "short_window",
                "display_name": "短期均线周期",
                "type": "int",
                "default": 5,
                "suggested_min": 2,
                "suggested_max": 50,
                "suggested_step": 1
            },
            {
                "name": "long_window",
                "display_name": "长期均线周期",
                "type": "int",
                "default": 20,
                "suggested_min": 10,
                "suggested_max": 100,
                "suggested_step": 5
            }
        ],
        "rsi": [
            {
                "name": "period",
                "display_name": "RSI周期",
                "type": "int",
                "default": 14,
                "suggested_min": 6,
                "suggested_max": 30,
                "suggested_step": 2
            },
            {
                "name": "overbought",
                "display_name": "超买阈值",
                "type": "float",
                "default": 70.0,
                "suggested_min": 60.0,
                "suggested_max": 90.0,
                "suggested_step": 5.0
            },
            {
                "name": "oversold",
                "display_name": "超卖阈值",
                "type": "float",
                "default": 30.0,
                "suggested_min": 10.0,
                "suggested_max": 40.0,
                "suggested_step": 5.0
            }
        ]
    }
    
    if strategy_type not in strategy_params:
        raise HTTPException(status_code=400, detail="不支持的策略类型")
    
    return {
        "success": True,
        "strategy_type": strategy_type,
        "parameters": strategy_params[strategy_type]
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
