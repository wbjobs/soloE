from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
import atexit

scheduler = BackgroundScheduler()


def start_scheduler():
    from .auction import run_auction_round

    if not scheduler.running:
        scheduler.add_job(
            run_auction_round,
            trigger=IntervalTrigger(seconds=10),
            id='auction_job',
            replace_existing=True
        )
        scheduler.start()

        atexit.register(lambda: scheduler.shutdown())
