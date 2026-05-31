from rest_framework import serializers
from .models import Node, Bid, Transaction, AuctionResult
from decimal import Decimal


class NodeSerializer(serializers.ModelSerializer):
    net_power = serializers.FloatField(read_only=True)
    is_seller = serializers.BooleanField(read_only=True)
    is_buyer = serializers.BooleanField(read_only=True)
    battery_soc_percent = serializers.FloatField(read_only=True)
    raw_net_power = serializers.FloatField(read_only=True)

    class Meta:
        model = Node
        fields = ['id', 'node_id', 'name', 'solar_capacity', 'load_capacity',
                  'current_generation', 'current_load', 'net_power', 'raw_net_power',
                  'is_seller', 'is_buyer', 'has_battery', 'battery_capacity',
                  'battery_soc', 'battery_soc_percent', 'battery_efficiency',
                  'battery_charge', 'battery_discharge', 'position_x', 'position_y']


class BidSerializer(serializers.ModelSerializer):
    node_name = serializers.CharField(source='node.name', read_only=True)

    class Meta:
        model = Bid
        fields = ['id', 'node', 'node_name', 'bid_type', 'quantity', 'price',
                  'auction_round', 'timestamp']


class TransactionSerializer(serializers.ModelSerializer):
    seller_name = serializers.CharField(source='seller.name', read_only=True)
    buyer_name = serializers.CharField(source='buyer.name', read_only=True)

    class Meta:
        model = Transaction
        fields = ['id', 'seller', 'seller_name', 'buyer', 'buyer_name',
                  'quantity', 'price', 'total_amount', 'auction_round', 'timestamp']


class AuctionResultSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuctionResult
        fields = ['id', 'auction_round', 'clearing_price', 'total_traded',
                  'timestamp', 'is_settled']
