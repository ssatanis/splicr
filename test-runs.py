import os
import psycopg
from dotenv import load_dotenv

load_dotenv("apps/web/.env.local")
url = os.environ["SUPABASE_DB_URL"]
conn = psycopg.connect(url)
cur = conn.cursor()
cur.execute("select id, status, (created_at at time zone 'UTC') as created_utc from public.runs order by created_at desc limit 10;")
for row in cur.fetchall():
    print(row)
