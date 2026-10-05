import os
import psycopg
from dotenv import load_dotenv

load_dotenv("apps/web/.env.local")
url = os.environ["SUPABASE_DB_URL"]
conn = psycopg.connect(url)
cur = conn.cursor()
cur.execute("SELECT prosrc FROM pg_proc WHERE proname = 'finish_pipeline_job';")
print(cur.fetchone()[0])
