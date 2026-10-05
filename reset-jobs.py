import os
import psycopg
from dotenv import load_dotenv

load_dotenv("apps/web/.env.local")
url = os.environ["SUPABASE_DB_URL"]
conn = psycopg.connect(url)
cur = conn.cursor()
cur.execute("UPDATE public.jobs SET status = 'queued', attempts = 0, scheduled_at = now(), lease_owner = null;")
cur.execute("UPDATE public.runs SET status = 'queued';")
cur.execute("UPDATE public.run_stages SET status = 'queued', started_at = null, finished_at = null;")
cur.execute("UPDATE public.screens SET status = 'queued';")
conn.commit()
print("Reset jobs successfully.")
