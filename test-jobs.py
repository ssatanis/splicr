import os
import psycopg
from dotenv import load_dotenv

load_dotenv("apps/web/.env.local")
url = os.environ["SUPABASE_DB_URL"]
conn = psycopg.connect(url)
cur = conn.cursor()
cur.execute("select count(*) from public.jobs where status = 'queued';")
print(f"Queued jobs: {cur.fetchone()[0]}")
