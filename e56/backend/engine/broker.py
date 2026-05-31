import random
from typing import Optional
from datetime import datetime
from .events import OrderEvent, FillEvent, OrderType


class SlippageModel:
    def __init__(self, slippage_type: str = 'fixed', **kwargs):
        self.slippage_type = slippage_type
        self.params = kwargs

    def calculate_slippage(self, price: float, quantity: int) -> float:
        if self.slippage_type == 'fixed':
            slippage_bps = self.params.get('bps', 5.0)
            return price * slippage_bps / 10000.0
        elif self.slippage_type == 'percentage':
            slippage_pct = self.params.get('percentage', 0.001)
            return price * slippage_pct
        elif self.slippage_type == 'random':
            max_bps = self.params.get('max_bps', 10.0)
            random_bps = random.uniform(0, max_bps)
            return price * random_bps / 10000.0
        return 0.0


class CommissionModel:
    def __init__(self, commission_type: str = 'percentage', **kwargs):
        self.commission_type = commission_type
        self.params = kwargs

    def calculate_commission(self, price: float, quantity: int) -> float:
        notional = abs(price * quantity)
        
        if self.commission_type == 'percentage':
            rate = self.params.get('rate', 0.001)
            min_commission = self.params.get('min', 1.0)
            return max(notional * rate, min_commission)
        elif self.commission_type == 'fixed_per_share':
            per_share = self.params.get('per_share', 0.01)
            min_commission = self.params.get('min', 1.0)
            return max(abs(quantity) * per_share, min_commission)
        elif self.commission_type == 'fixed':
            return self.params.get('fixed', 5.0)
        return 0.0


class Broker:
    def __init__(self, slippage_model: SlippageModel = None, commission_model: CommissionModel = None):
        self.slippage_model = slippage_model or SlippageModel('fixed', bps=5.0)
        self.commission_model = commission_model or CommissionModel('percentage', rate=0.001, min=1.0)

    def execute_order(self, order: OrderEvent, current_price: float) -> Optional[FillEvent]:
        if order.order_type == OrderType.MARKET:
            slippage = self.slippage_model.calculate_slippage(current_price, order.quantity)
            
            if order.quantity > 0:
                fill_price = current_price + slippage
            else:
                fill_price = current_price - slippage
            
            commission = self.commission_model.calculate_commission(fill_price, order.quantity)
            
            return FillEvent(
                timestamp=order.timestamp,
                symbol=order.symbol,
                quantity=order.quantity,
                price=fill_price,
                commission=commission,
                slippage=slippage
            )
        
        return None
