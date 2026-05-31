from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from .models import Node, Bid, Transaction, AuctionResult
from .serializers import NodeSerializer, BidSerializer, TransactionSerializer, AuctionResultSerializer
from .auction import run_auction_round, update_and_manage_battery


class NodeViewSet(viewsets.ModelViewSet):
    queryset = Node.objects.all()
    serializer_class = NodeSerializer


class BidViewSet(viewsets.ModelViewSet):
    queryset = Bid.objects.all()
    serializer_class = BidSerializer


class TransactionViewSet(viewsets.ModelViewSet):
    queryset = Transaction.objects.all()
    serializer_class = TransactionSerializer


class AuctionResultViewSet(viewsets.ModelViewSet):
    queryset = AuctionResult.objects.all()
    serializer_class = AuctionResultSerializer


class GridStateView(APIView):
    def get(self, request):
        nodes = Node.objects.all()
        node_serializer = NodeSerializer(nodes, many=True)

        latest_result = AuctionResult.objects.order_by('-auction_round').first()
        result_serializer = AuctionResultSerializer(latest_result) if latest_result else None

        current_round = latest_result.auction_round if latest_result else 0
        transactions = Transaction.objects.filter(auction_round=current_round)
        trans_serializer = TransactionSerializer(transactions, many=True)

        data = {
            'nodes': node_serializer.data,
            'latest_auction': result_serializer.data if result_serializer else None,
            'transactions': trans_serializer.data,
            'current_round': current_round
        }

        return Response(data)


class TriggerAuctionView(APIView):
    def post(self, request):
        result = run_auction_round()
        return Response(result, status=status.HTTP_200_OK)


class UpdatePowerView(APIView):
    def post(self, request):
        update_and_manage_battery()
        nodes = Node.objects.all()
        serializer = NodeSerializer(nodes, many=True)
        return Response({'nodes': serializer.data}, status=status.HTTP_200_OK)
