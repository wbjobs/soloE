from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    NodeViewSet, BidViewSet, TransactionViewSet, AuctionResultViewSet,
    GridStateView, TriggerAuctionView, UpdatePowerView
)

router = DefaultRouter()
router.register(r'nodes', NodeViewSet)
router.register(r'bids', BidViewSet)
router.register(r'transactions', TransactionViewSet)
router.register(r'auction-results', AuctionResultViewSet)

urlpatterns = [
    path('', include(router.urls)),
    path('grid-state/', GridStateView.as_view(), name='grid-state'),
    path('trigger-auction/', TriggerAuctionView.as_view(), name='trigger-auction'),
    path('update-power/', UpdatePowerView.as_view(), name='update-power'),
]
