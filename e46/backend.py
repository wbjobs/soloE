import numpy as np
import multiprocessing as mp
from fastapi import FastAPI, UploadFile, File, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import scipy.stats as stats
from io import StringIO
import pandas as pd

app = FastAPI()

class OptionParams(BaseModel):
    S: float
    K: float
    T: float
    r: float
    sigma: float
    option_type: str
    num_simulations: int = 1000000

class VolatilitySurfaceRequest(BaseModel):
    S: float
    r: float
    strikes: List[float]
    maturities: List[float]
    option_prices: Optional[List[List[float]]] = None
    option_type: str = 'call'

def black_scholes(S, K, T, r, sigma, option_type='call'):
    d1 = (np.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * np.sqrt(T))
    d2 = d1 - sigma * np.sqrt(T)
    
    if option_type == 'call':
        price = S * stats.norm.cdf(d1) - K * np.exp(-r * T) * stats.norm.cdf(d2)
    else:
        price = K * np.exp(-r * T) * stats.norm.cdf(-d2) - S * stats.norm.cdf(-d1)
    
    return price

def black_scholes_vega(S, K, T, r, sigma):
    d1 = (np.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * np.sqrt(T))
    vega = S * stats.norm.pdf(d1) * np.sqrt(T)
    return vega

def implied_volatility_newton(S, K, T, r, option_price, option_type='call', max_iter=100, tol=1e-8):
    sigma = 0.2
    
    for i in range(max_iter):
        price = black_scholes(S, K, T, r, sigma, option_type)
        vega = black_scholes_vega(S, K, T, r, sigma)
        
        if vega < 1e-10:
            break
        
        price_diff = price - option_price
        sigma = sigma - price_diff / vega
        
        if abs(price_diff) < tol:
            break
    
    return max(0.001, min(sigma, 5.0))

def calculate_historical_volatility(prices, annualization_factor=252):
    prices = np.array(prices)
    log_returns = np.log(prices[1:] / prices[:-1])
    daily_vol = np.std(log_returns, ddof=1)
    annual_vol = daily_vol * np.sqrt(annualization_factor)
    return float(annual_vol), log_returns.tolist()

def compute_chunk_statistics(args):
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

def calculate_greeks(S, K, T, r, sigma, option_type, num_simulations=100000):
    dt = T
    drift = (r - 0.5 * sigma**2) * dt
    diffusion = sigma * np.sqrt(dt)
    
    Z = np.random.standard_normal(num_simulations)
    
    ST = S * np.exp(drift + diffusion * Z)
    ST_plus = (S + 1) * np.exp(drift + diffusion * Z)
    ST_minus = (S - 1) * np.exp(drift + diffusion * Z)
    ST_sigma_plus = S * np.exp((r - 0.5 * (sigma + 0.01)**2) * dt + (sigma + 0.01) * np.sqrt(dt) * Z)
    ST_T_minus = S * np.exp((r - 0.5 * sigma**2) * (dt - 1/365) + sigma * np.sqrt(dt - 1/365) * Z)
    
    if option_type == 'call':
        payoff = np.maximum(ST - K, 0)
        payoff_plus = np.maximum(ST_plus - K, 0)
        payoff_minus = np.maximum(ST_minus - K, 0)
        payoff_sigma_plus = np.maximum(ST_sigma_plus - K, 0)
        payoff_T_minus = np.maximum(ST_T_minus - K, 0)
    else:
        payoff = np.maximum(K - ST, 0)
        payoff_plus = np.maximum(K - ST_plus, 0)
        payoff_minus = np.maximum(K - ST_minus, 0)
        payoff_sigma_plus = np.maximum(K - ST_sigma_plus, 0)
        payoff_T_minus = np.maximum(K - ST_T_minus, 0)
    
    price = np.exp(-r * T) * np.mean(payoff)
    price_plus = np.exp(-r * T) * np.mean(payoff_plus)
    price_minus = np.exp(-r * T) * np.mean(payoff_minus)
    price_sigma_plus = np.exp(-r * T) * np.mean(payoff_sigma_plus)
    price_T_minus = np.exp(-r * (T - 1/365)) * np.mean(payoff_T_minus)
    
    delta = (price_plus - price_minus) / 2
    gamma = (price_plus - 2 * price + price_minus)
    vega = (price_sigma_plus - price) / 0.01
    theta = (price_T_minus - price) / (1/365)
    
    return {
        'delta': float(delta),
        'gamma': float(gamma),
        'vega': float(vega),
        'theta': float(theta)
    }

@app.post("/price-option")
async def price_option(params: OptionParams):
    num_workers = mp.cpu_count()
    N = params.num_simulations
    
    chunk_size = N // num_workers
    remaining = N % num_workers
    
    seeds = [np.random.randint(0, 1000000) for _ in range(num_workers)]
    
    args_list = []
    for i in range(num_workers):
        current_chunk = chunk_size + (1 if i < remaining else 0)
        args_list.append((
            params.S, params.K, params.T, params.r, params.sigma,
            params.option_type, current_chunk, seeds[i]
        ))
    
    with mp.Pool(num_workers) as pool:
        results = pool.map(compute_chunk_statistics, args_list)
    
    total_sum = sum(r[0] for r in results)
    total_n = sum(r[2] for r in results)
    
    option_price = total_sum / total_n
    
    all_conv_samples = []
    all_hist_samples = []
    for r in results:
        all_conv_samples.extend(r[3])
        all_hist_samples.extend(r[4])
    
    conv_array = np.array(all_conv_samples)
    conv_array.sort()
    convergence = []
    n_conv_points = min(100, len(conv_array))
    for i in range(1, n_conv_points + 1):
        idx = int(i * len(conv_array) / n_conv_points) - 1
        convergence.append(float(np.mean(conv_array[:idx+1])))
    
    hist_array = np.array(all_hist_samples)
    
    greeks = calculate_greeks(
        params.S, params.K, params.T, params.r, params.sigma,
        params.option_type
    )
    
    max_hist_samples = min(len(hist_array), 50000)
    price_dist_for_hist = hist_array[:max_hist_samples].tolist()
    
    bs_price = black_scholes(params.S, params.K, params.T, params.r, params.sigma, params.option_type)
    
    return {
        'option_price': float(option_price),
        'bs_price': float(bs_price),
        'greeks': greeks,
        'convergence': convergence,
        'price_distribution': price_dist_for_hist,
        'num_simulations': N,
        'num_workers': num_workers,
        'data_transfer_size': f'{len(all_conv_samples) + len(all_hist_samples)} floats (~{8*(len(all_conv_samples) + len(all_hist_samples))/1024/1024:.2f} MB)'
    }

@app.post("/calculate-historical-volatility")
async def calculate_hist_vol(file: UploadFile = File(...)):
    try:
        contents = await file.read()
        df = pd.read_csv(StringIO(contents.decode('utf-8')))
        
        price_columns = [col for col in df.columns if 'close' in col.lower() or 'price' in col.lower() or col.lower() in ['adj close', 'close']]
        
        if not price_columns:
            price_columns = [df.columns[-1]]
        
        prices = df[price_columns[0]].dropna().values.tolist()
        
        if len(prices) < 2:
            raise HTTPException(status_code=400, detail="Not enough price data points")
        
        annual_vol, log_returns = calculate_historical_volatility(prices)
        
        return {
            'historical_volatility': annual_vol,
            'historical_volatility_pct': annual_vol * 100,
            'num_days': len(prices),
            'prices': prices[-30:],
            'log_returns': log_returns[-30:],
            'price_column': price_columns[0]
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/calculate-implied-volatility")
async def calculate_implied_vol(params: dict):
    try:
        S = params['S']
        K = params['K']
        T = params['T']
        r = params['r']
        option_price = params['option_price']
        option_type = params.get('option_type', 'call')
        
        iv = implied_volatility_newton(S, K, T, r, option_price, option_type)
        
        return {
            'implied_volatility': float(iv),
            'implied_volatility_pct': float(iv * 100)
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/volatility-surface")
async def generate_volatility_surface(request: VolatilitySurfaceRequest):
    try:
        strikes = request.strikes
        maturities = request.maturities
        S = request.S
        r = request.r
        option_type = request.option_type
        
        vol_surface = []
        
        for i, K in enumerate(strikes):
            vol_row = []
            for j, T in enumerate(maturities):
                if request.option_prices and i < len(request.option_prices) and j < len(request.option_prices[i]):
                    option_price = request.option_prices[i][j]
                    iv = implied_volatility_newton(S, K, T, r, option_price, option_type)
                else:
                    atm_vol = 0.2
                    moneyness = K / S
                    time_factor = 1 + 0.1 * (1 - T) if T < 1 else 1
                    smile_factor = 1 + 0.3 * (moneyness - 1)**2
                    iv = atm_vol * smile_factor * time_factor
                
                vol_row.append(float(iv * 100))
            
            vol_surface.append(vol_row)
        
        return {
            'volatility_surface': vol_surface,
            'strikes': strikes,
            'maturities': maturities,
            'S': S,
            'r': r
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/black-scholes-price")
async def get_bs_price(S: float, K: float, T: float, r: float, sigma: float, option_type: str = 'call'):
    price = black_scholes(S, K, T, r, sigma, option_type)
    return {'black_scholes_price': float(price)}

@app.get("/health")
async def health_check():
    return {"status": "healthy", "cpu_cores": mp.cpu_count()}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
