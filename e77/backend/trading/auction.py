import random
from decimal import Decimal, ROUND_HALF_UP
from .models import Node, Bid, Transaction, AuctionResult


def round_decimal(value, places=4):
    return Decimal(str(value)).quantize(Decimal(f'0.{"0" * places}'), rounding=ROUND_HALF_UP)


class DoubleAuction:
    def __init__(self, auction_round):
        self.auction_round = auction_round
        self.buyers = []
        self.sellers = []
        self.transactions = []
        self.clearing_price = Decimal('0.0000')
        self.total_traded = Decimal('0.0000')

    def generate_bids(self):
        nodes = Node.objects.all()
        self.buyers = []
        self.sellers = []

        for node in nodes:
            net = node.net_power()
            if abs(net) < Decimal('0.01'):
                continue

            if net < 0:
                quantity = abs(net)
                price = round_decimal(random.uniform(0.5, 1.5), 4)
                self.buyers.append({
                    'node': node,
                    'quantity': quantity,
                    'price': price,
                    'remaining': quantity
                })
                Bid.objects.create(
                    node=node,
                    bid_type='buy',
                    quantity=quantity,
                    price=price,
                    auction_round=self.auction_round
                )
            else:
                quantity = net
                price = round_decimal(random.uniform(0.3, 1.0), 4)
                self.sellers.append({
                    'node': node,
                    'quantity': quantity,
                    'price': price,
                    'remaining': quantity
                })
                Bid.objects.create(
                    node=node,
                    bid_type='sell',
                    quantity=quantity,
                    price=price,
                    auction_round=self.auction_round
                )

    def match_bids(self):
        self.buyers.sort(key=lambda x: x['price'], reverse=True)
        self.sellers.sort(key=lambda x: x['price'])

        buyer_idx = 0
        seller_idx = 0
        total_volume = Decimal('0.0000')

        while buyer_idx < len(self.buyers) and seller_idx < len(self.sellers):
            buyer = self.buyers[buyer_idx]
            seller = self.sellers[seller_idx]

            if buyer['price'] >= seller['price']:
                trade_quantity = min(buyer['remaining'], seller['remaining'])
                trade_price = round_decimal((buyer['price'] + seller['price']) / 2, 4)
                total_amount = round_decimal(trade_quantity * trade_price, 4)

                Transaction.objects.create(
                    seller=seller['node'],
                    buyer=buyer['node'],
                    quantity=trade_quantity,
                    price=trade_price,
                    total_amount=total_amount,
                    auction_round=self.auction_round
                )

                self.transactions.append({
                    'seller': seller['node'].node_id,
                    'buyer': buyer['node'].node_id,
                    'quantity': float(trade_quantity),
                    'price': float(trade_price)
                })

                buyer['remaining'] = round_decimal(buyer['remaining'] - trade_quantity, 4)
                seller['remaining'] = round_decimal(seller['remaining'] - trade_quantity, 4)
                total_volume = round_decimal(total_volume + trade_quantity, 4)
                self.clearing_price = trade_price

                if buyer['remaining'] < Decimal('0.01'):
                    buyer_idx += 1
                if seller['remaining'] < Decimal('0.01'):
                    seller_idx += 1
            else:
                break

        self.total_traded = total_volume

        AuctionResult.objects.create(
            auction_round=self.auction_round,
            clearing_price=self.clearing_price,
            total_traded=self.total_traded,
            is_settled=True
        )

        return self.transactions

    def run_auction(self):
        self.generate_bids()
        return self.match_bids()


def update_and_manage_battery():
    nodes = Node.objects.all()
    for node in nodes:
        solar_factor = Decimal(str(random.uniform(0.3, 1.0)))
        node.current_generation = round_decimal(node.solar_capacity * solar_factor, 4)
        load_factor = Decimal(str(random.uniform(0.6, 1.2)))
        node.current_load = round_decimal(node.load_capacity * load_factor, 4)

        node.battery_charge = Decimal('0.0000')
        node.battery_discharge = Decimal('0.0000')

        if node.has_battery:
            raw_net = node.raw_net_power()

            if raw_net > 0:
                max_charge = (node.battery_capacity - node.battery_soc) / node.battery_efficiency
                charge_amount = min(raw_net, max_charge)
                if charge_amount > 0:
                    node.battery_charge = round_decimal(charge_amount, 4)
                    actual_soc_increase = round_decimal(charge_amount * node.battery_efficiency, 4)
                    node.battery_soc = round_decimal(node.battery_soc + actual_soc_increase, 4)

            elif raw_net < 0:
                deficit = abs(raw_net)
                max_discharge = node.battery_soc * node.battery_efficiency
                discharge_amount = min(deficit, max_discharge)
                if discharge_amount > 0:
                    actual_soc_decrease = round_decimal(discharge_amount / node.battery_efficiency, 4)
                    node.battery_discharge = round_decimal(discharge_amount, 4)
                    node.battery_soc = round_decimal(node.battery_soc - actual_soc_decrease, 4)

            node.battery_soc = max(Decimal('0.0000'), min(node.battery_capacity, node.battery_soc))

        node.save()


def run_auction_round():
    from django.db.models import Max
    max_round = AuctionResult.objects.aggregate(Max('auction_round'))['auction_round__max']
    next_round = (max_round or 0) + 1

    update_and_manage_battery()

    auction = DoubleAuction(next_round)
    transactions = auction.run_auction()

    return {
        'round': next_round,
        'clearing_price': float(auction.clearing_price),
        'total_traded': float(auction.total_traded),
        'transactions': transactions
    }
