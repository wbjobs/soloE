from django.db import models
from django.utils import timezone
from decimal import Decimal


class Node(models.Model):
    node_id = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=100)
    solar_capacity = models.DecimalField(max_digits=10, decimal_places=4, default=Decimal('0.0000'))
    load_capacity = models.DecimalField(max_digits=10, decimal_places=4, default=Decimal('0.0000'))
    current_generation = models.DecimalField(max_digits=10, decimal_places=4, default=Decimal('0.0000'))
    current_load = models.DecimalField(max_digits=10, decimal_places=4, default=Decimal('0.0000'))
    has_battery = models.BooleanField(default=True)
    battery_capacity = models.DecimalField(max_digits=10, decimal_places=4, default=Decimal('10.0000'))
    battery_soc = models.DecimalField(max_digits=10, decimal_places=4, default=Decimal('5.0000'))
    battery_efficiency = models.DecimalField(max_digits=5, decimal_places=4, default=Decimal('0.9000'))
    battery_charge = models.DecimalField(max_digits=10, decimal_places=4, default=Decimal('0.0000'))
    battery_discharge = models.DecimalField(max_digits=10, decimal_places=4, default=Decimal('0.0000'))
    position_x = models.IntegerField(default=0)
    position_y = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def raw_net_power(self):
        return Decimal(self.current_generation) - Decimal(self.current_load)

    def net_power(self):
        raw = self.raw_net_power()
        if not self.has_battery:
            return raw
        if raw > 0:
            charge_amount = min(raw, (self.battery_capacity - self.battery_soc) / self.battery_efficiency)
            return raw - charge_amount
        else:
            deficit = abs(raw)
            max_discharge = self.battery_soc * self.battery_efficiency
            discharge_amount = min(deficit, max_discharge)
            return raw + discharge_amount

    def battery_soc_percent(self):
        if self.battery_capacity == 0:
            return Decimal('0.0000')
        return (self.battery_soc / self.battery_capacity) * Decimal('100')

    def is_seller(self):
        return self.net_power() > Decimal('0.01')

    def is_buyer(self):
        return self.net_power() < Decimal('-0.01')

    def __str__(self):
        return f"{self.name} ({self.node_id})"


class Bid(models.Model):
    node = models.ForeignKey(Node, on_delete=models.CASCADE, related_name='bids')
    bid_type = models.CharField(max_length=10, choices=[('buy', '买入'), ('sell', '卖出')])
    quantity = models.DecimalField(max_digits=10, decimal_places=4)
    price = models.DecimalField(max_digits=10, decimal_places=4)
    timestamp = models.DateTimeField(default=timezone.now)
    auction_round = models.IntegerField(default=0)

    def __str__(self):
        return f"{self.node.name} {self.bid_type} {self.quantity}kWh @ {self.price}元"


class Transaction(models.Model):
    seller = models.ForeignKey(Node, on_delete=models.CASCADE, related_name='sales')
    buyer = models.ForeignKey(Node, on_delete=models.CASCADE, related_name='purchases')
    quantity = models.DecimalField(max_digits=10, decimal_places=4)
    price = models.DecimalField(max_digits=10, decimal_places=4)
    total_amount = models.DecimalField(max_digits=12, decimal_places=4)
    auction_round = models.IntegerField(default=0)
    timestamp = models.DateTimeField(default=timezone.now)

    def __str__(self):
        return f"{self.seller.name} → {self.buyer.name}: {self.quantity}kWh @ {self.price}元"


class AuctionResult(models.Model):
    auction_round = models.IntegerField(unique=True)
    clearing_price = models.DecimalField(max_digits=10, decimal_places=4, default=Decimal('0.0000'))
    total_traded = models.DecimalField(max_digits=12, decimal_places=4, default=Decimal('0.0000'))
    timestamp = models.DateTimeField(default=timezone.now)
    is_settled = models.BooleanField(default=False)

    def __str__(self):
        return f"Round {self.auction_round}: 价格={self.clearing_price}, 交易量={self.total_traded}"
