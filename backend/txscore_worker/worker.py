import os
import redis
from rq import Worker, Queue, Connection
import txscore_engine  # Ensure this is imported so functions are registered

listen = ['default']

REDIS_URL = os.getenv('REDIS_URL', 'redis://localhost:6379')

if __name__ == '__main__':
    conn = redis.from_url(REDIS_URL)
    with Connection(conn):
        worker = Worker(list(map(Queue, listen)))
        worker.work()
