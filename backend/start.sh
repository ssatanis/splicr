#!/bin/bash
set -e

echo "==================================="
echo "SplicR Backend - Railway Startup"
echo "==================================="

# Print environment info
echo "Environment: ${RAILWAY_ENVIRONMENT:-development}"
echo "Service: ${RAILWAY_SERVICE_NAME:-splicr}"
echo "Python version: $(python --version)"
echo "Working directory: $(pwd)"

# Check critical environment variables
if [ -z "$DATABASE_URL" ]; then
    echo "ERROR: DATABASE_URL not set!"
    exit 1
fi

if [ -z "$REDIS_URL" ]; then
    echo "ERROR: REDIS_URL not set!"
    exit 1
fi

if [ -z "$SECRET_KEY" ]; then
    echo "WARNING: SECRET_KEY not set! Generating temporary key..."
    export SECRET_KEY=$(python -c "import secrets; print(secrets.token_urlsafe(32))")
fi

# Test database connection
echo "Testing database connection..."
python -c "
import psycopg2
import os
import sys
try:
    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    conn.close()
    print('✓ Database connection successful')
except Exception as e:
    print(f'✗ Database connection failed: {e}')
    sys.exit(1)
"

# Test Redis connection
echo "Testing Redis connection..."
python -c "
import redis
import os
import sys
try:
    r = redis.from_url(os.environ['REDIS_URL'])
    r.ping()
    print('✓ Redis connection successful')
except Exception as e:
    print(f'✗ Redis connection failed: {e}')
    sys.exit(1)
"

# Run database migrations
echo "Running database migrations..."
if [ -f "alembic.ini" ]; then
    alembic upgrade head || echo "WARNING: Migration failed but continuing..."
else
    echo "No alembic.ini found, skipping migrations"
fi

# Start the application
echo "==================================="
echo "Starting SplicR API..."
echo "Port: ${PORT:-8000}"
echo "Workers: ${WORKERS:-2}"
echo "==================================="

exec python -m uvicorn app.main:app \
    --host 0.0.0.0 \
    --port "${PORT:-8000}" \
    --workers "${WORKERS:-2}" \
    --log-level info \
    --access-log \
    --use-colors
