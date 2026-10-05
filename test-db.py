import os
import psycopg
from dotenv import load_dotenv

load_dotenv("apps/web/.env.local")
url = os.environ["SUPABASE_DB_URL"]
conn = psycopg.connect(url)
cur = conn.cursor()
cur.execute("select id, status, error, lease_owner, attempts from public.jobs order by created_at desc limit 10;")
for row in cur.fetchall():
    print(row)
