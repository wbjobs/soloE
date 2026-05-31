from django.core.management.base import BaseCommand
from trading.models import Node
from decimal import Decimal


class Command(BaseCommand):
    help = 'Initialize 5 microgrid nodes'

    def handle(self, *args, **options):
        nodes_data = [
            {
                'node_id': 'node_1',
                'name': '节点1 - 居民区A',
                'solar_capacity': Decimal('5.0000'),
                'load_capacity': Decimal('4.0000'),
                'has_battery': True,
                'battery_capacity': Decimal('10.0000'),
                'battery_soc': Decimal('5.0000'),
                'battery_efficiency': Decimal('0.9000'),
                'position_x': 200,
                'position_y': 150,
            },
            {
                'node_id': 'node_2',
                'name': '节点2 - 商业区B',
                'solar_capacity': Decimal('3.0000'),
                'load_capacity': Decimal('6.0000'),
                'has_battery': True,
                'battery_capacity': Decimal('10.0000'),
                'battery_soc': Decimal('7.0000'),
                'battery_efficiency': Decimal('0.9000'),
                'position_x': 500,
                'position_y': 150,
            },
            {
                'node_id': 'node_3',
                'name': '节点3 - 工业区C',
                'solar_capacity': Decimal('8.0000'),
                'load_capacity': Decimal('5.0000'),
                'has_battery': True,
                'battery_capacity': Decimal('10.0000'),
                'battery_soc': Decimal('3.0000'),
                'battery_efficiency': Decimal('0.9000'),
                'position_x': 700,
                'position_y': 300,
            },
            {
                'node_id': 'node_4',
                'name': '节点4 - 居民区D',
                'solar_capacity': Decimal('4.0000'),
                'load_capacity': Decimal('3.5000'),
                'has_battery': True,
                'battery_capacity': Decimal('10.0000'),
                'battery_soc': Decimal('6.0000'),
                'battery_efficiency': Decimal('0.9000'),
                'position_x': 350,
                'position_y': 400,
            },
            {
                'node_id': 'node_5',
                'name': '节点5 - 公共设施E',
                'solar_capacity': Decimal('6.0000'),
                'load_capacity': Decimal('5.5000'),
                'has_battery': True,
                'battery_capacity': Decimal('10.0000'),
                'battery_soc': Decimal('4.0000'),
                'battery_efficiency': Decimal('0.9000'),
                'position_x': 100,
                'position_y': 350,
            },
        ]

        for data in nodes_data:
            node, created = Node.objects.get_or_create(
                node_id=data['node_id'],
                defaults=data
            )
            if created:
                node.current_generation = Decimal(str(data['solar_capacity'])) * Decimal('0.7')
                node.current_load = Decimal(str(data['load_capacity'])) * Decimal('0.8')
                node.save()
                self.stdout.write(self.style.SUCCESS(f'Created node: {data["name"]}'))
            else:
                self.stdout.write(f'Node already exists: {data["name"]}')

        self.stdout.write(self.style.SUCCESS('Successfully initialized all nodes'))
