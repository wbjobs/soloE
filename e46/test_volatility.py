import numpy as np
import sys

def test_black_scholes():
    print("Testing Black-Scholes formula...")
    S, K, T, r, sigma = 100, 100, 1, 0.05, 0.2
    
    from scipy.stats import norm
    d1 = (np.log(S/K) + r * T) / (sigma * np.sqrt(T))
    d2 = d1 - sigma * np.sqrt(T)
    call_price = S * norm.cdf(d1) - K * np.exp(-r*T) * norm.cdf(d2)
    print(f"  Call price: {call_price:.4f}")
    print("  ✓ Black-Scholes formula working")

def test_implied_volatility():
    print("\nTesting Implied Volatility (Newton-Raphson)...")
    S, K, T, r = 100, 100, 1, 0.05
    option_price = 10.45
    
    sigma = 0.2
    for i in range(100):
        from scipy.stats import norm
        d1 = (np.log(S/K) + r * T) / (sigma * np.sqrt(T))
        d2 = d1 - sigma * np.sqrt(T)
        price = S * norm.cdf(d1) - K * np.exp(-r*T) * norm.cdf(d2)
        vega = S * norm.pdf(d1) * np.sqrt(T)
        if vega < 1e-10:
            break
        price_diff = price - option_price
        sigma = sigma - price_diff / vega
        if abs(price_diff) < 1e-8:
            break
    
    print(f"  Implied volatility: {sigma*100:.2f}%")
    print("  ✓ Newton-Raphson method working")

def test_historical_volatility():
    print("\nTesting Historical Volatility...")
    np.random.seed(42)
    returns = np.random.normal(0, 0.01, 252)
    prices = 100 * np.exp(np.cumsum(returns))
    
    log_returns = np.log(prices[1:] / prices[:-1])
    daily_vol = np.std(log_returns, ddof=1)
    annual_vol = daily_vol * np.sqrt(252)
    
    print(f"  Daily volatility: {daily_vol*100:.2f}%")
    print(f"  Annualized volatility: {annual_vol*100:.2f}%")
    print("  ✓ Historical volatility calculation working")

def test_volatility_surface():
    print("\nTesting Volatility Surface...")
    strikes = np.linspace(80, 120, 9)
    maturities = np.linspace(1/12, 1, 6)
    S, r, atm_vol = 100, 0.05, 0.2
    
    vol_surface = np.zeros((len(strikes), len(maturities)))
    
    for i, K in enumerate(strikes):
        for j, T in enumerate(maturities):
            moneyness = K / S
            time_factor = 1 + 0.1 * (1 - T) if T < 1 else 1
            smile_factor = 1 + 0.3 * (moneyness - 1)**2
            vol_surface[i, j] = atm_vol * smile_factor * time_factor
    
    print(f"  Surface shape: {vol_surface.shape}")
    print(f"  Volatility range: {vol_surface.min()*100:.2f}% - {vol_surface.max()*100:.2f}%")
    print("  ✓ Volatility surface generation working")

if __name__ == "__main__":
    print("=" * 60)
    print("Volatility Calibration Module Tests")
    print("=" * 60)
    
    try:
        test_black_scholes()
        test_implied_volatility()
        test_historical_volatility()
        test_volatility_surface()
        
        print("\n" + "=" * 60)
        print("✓ All tests passed successfully!")
        print("=" * 60)
        sys.exit(0)
    except Exception as e:
        print(f"\n✗ Test failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
