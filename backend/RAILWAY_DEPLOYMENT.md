# SplicR Backend - Railway Deployment Guide

## ✅ Pre-Deployment Checklist

### 1. Environment Variables (Set in Railway Dashboard)

#### Critical (Required)
- ✅ `DATABASE_URL` - PostgreSQL connection string from Supabase
- ✅ `REDIS_URL` - Redis connection URL from Upstash
- ✅ `SECRET_KEY` - Generate with: `openssl rand -hex 32`
- ✅ `S3_BUCKET_NAME` - Cloudflare R2 bucket name
- ✅ `AWS_ACCESS_KEY_ID` - R2 access key
- ✅ `AWS_SECRET_ACCESS_KEY` - R2 secret key
- ✅ `R2_ENDPOINT_URL` - Cloudflare R2 endpoint

#### Recommended
- `WORKERS` - Number of Uvicorn workers (default: 2)
- `PORT` - Port number (Railway sets automatically, default: 8000)
- `CORS_ORIGINS` - JSON array of allowed origins
- `AWS_BATCH_JOB_QUEUE` - If using AWS Batch
- `AWS_BATCH_JOB_DEFINITION` - If using AWS Batch

### 2. Verify Database Schema

The following tables must exist:
- `users` (auth)
- `api_keys` (API key management)
- `analyses` (CRISPR analysis tracking)
- `tx_*` tables (TxScore/Therapeutic Viability)
- `reference_*` tables (Gene sets)

Run migrations before deploying:
```bash
cd backend
alembic upgrade head
```

### 3. Verify Redis Connection

Test Redis connectivity:
```bash
redis-cli --tls -u "$REDIS_URL" PING
```

Should return: `PONG`

### 4. Verify R2/S3 Storage

Test bucket access:
```python
import boto3
from botocore.client import Config

s3 = boto3.client(
    's3',
    endpoint_url='YOUR_R2_ENDPOINT',
    aws_access_key_id='YOUR_ACCESS_KEY',
    aws_secret_access_key='YOUR_SECRET_KEY',
    config=Config(signature_version='s3v4'),
    region_name='auto'
)

# Test bucket access
s3.list_objects_v2(Bucket='YOUR_BUCKET', MaxKeys=1)
```

## 📦 Deployment Steps

### Option 1: Automatic Deployment (Recommended)

Railway will automatically build and deploy when you push to the connected Git repository.

1. Connect Repository to Railway:
   - Go to Railway Dashboard
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose `splicr` repository
   - Select `backend/` as root directory

2. Configure Service:
   - Service Name: `splicr`
   - Build Command: Auto-detected from `railway.json`
   - Start Command: `bash start.sh`

3. Add Environment Variables:
   - Copy from `.env.railway.production`
   - Replace placeholder values with actual credentials

### Option 2: Manual Deployment via Railway CLI

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login to Railway
railway login

# Link to project
railway link d57231af-7a86-4491-a1ae-8faf503e3a50

# Deploy
cd backend
railway up
```

## 🔍 Post-Deployment Verification

### 1. Health Check
```bash
curl https://splicr-production.up.railway.app/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2026-02-14T...",
  "version": "1.0.0"
}
```

### 2. Readiness Check
```bash
curl https://splicr-production.up.railway.app/health/ready
```

Expected response:
```json
{
  "status": "ready",
  "database": "connected",
  "redis": "connected",
  "timestamp": "2026-02-14T..."
}
```

### 3. API Documentation
Visit: `https://splicr-production.up.railway.app/docs`

Should display FastAPI Swagger UI with all endpoints.

### 4. Test Authentication
```bash
curl -X POST https://splicr-production.up.railway.app/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "testpassword123",
    "display_name": "Test User"
  }'
```

### 5. Test TEA Prediction
```bash
# Get auth token first, then:
curl -X POST https://splicr-production.up.railway.app/api/v1/tea/predict/efficiency \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "sequence": "ACGTACGTACGTACGTACGTACG",
    "model": "pridict"
  }'
```

Expected: JSON response with efficiency_score, confidence, and details.

## 🐛 Troubleshooting

### Database Connection Fails
```bash
# Check DATABASE_URL format
echo $DATABASE_URL
# Should be: postgresql://user:pass@host:port/db

# Test connection
psql $DATABASE_URL -c "SELECT version();"
```

### Redis Connection Fails
```bash
# Check REDIS_URL format
echo $REDIS_URL
# Should be: redis://default:password@host:port OR rediss:// for TLS

# Test connection
redis-cli -u $REDIS_URL PING
```

### S3/R2 Upload Fails
- Verify bucket exists
- Check CORS settings on R2 bucket
- Verify access key has write permissions
- Check R2_ENDPOINT_URL format (must include https://)

### Celery Tasks Not Running
```bash
# Start Celery worker separately (if needed)
celery -A app.tasks.celery_tasks worker --loglevel=info
```

### Analysis Jobs Fail
- Check AWS Batch configuration (if using)
- Verify analysis container image is built
- Check CloudWatch logs for container errors
- Ensure MAGeCK/BAGEL2 tools are installed in analysis container

## 📊 Monitoring

### Railway Dashboard
- View logs: Railway Dashboard → Service → Logs
- Monitor metrics: CPU, Memory, Network
- Check deployments: Deployment history and status

### Application Logs
```bash
# Via Railway CLI
railway logs
```

### Database Queries
```sql
-- Check active analyses
SELECT id, status, progress, current_step, created_at 
FROM analyses 
WHERE status IN ('RUNNING', 'QUEUED') 
ORDER BY created_at DESC;

-- Check recent errors
SELECT id, status, error_message, created_at 
FROM analyses 
WHERE status = 'FAILED' 
ORDER BY created_at DESC 
LIMIT 10;
```

### Redis Queue Status
```bash
redis-cli -u $REDIS_URL INFO stats
redis-cli -u $REDIS_URL KEYS "celery-task-meta-*" | wc -l
```

## 🔐 Security Best Practices

1. **Never commit `.env` files**
   - Use `.gitignore` to exclude `.env*`
   - Store secrets in Railway environment variables

2. **Rotate API keys regularly**
   - SECRET_KEY: Every 90 days
   - Database passwords: Every 180 days
   - S3 access keys: Every 180 days

3. **Monitor access logs**
   - Review authentication failures
   - Check for unusual API usage patterns
   - Monitor database connection attempts

4. **Enable HTTPS only**
   - Railway provides automatic HTTPS
   - Verify CORS_ORIGINS only includes HTTPS URLs (except localhost)

5. **Use least-privilege credentials**
   - Database user: Only necessary permissions
   - S3/R2 keys: Bucket-specific access only

## 🚀 Performance Optimization

### Recommended Railway Service Configuration
- **Memory**: 2GB minimum (4GB recommended)
- **CPU**: 2 vCPUs minimum
- **Workers**: 2-4 (based on traffic)
- **Database**: Connection pooling enabled (pool_size=10)

### Scaling Strategy
1. Monitor request latency and error rates
2. Scale workers horizontally if CPU > 70%
3. Scale memory if OOM errors occur
4. Consider Redis caching for expensive queries

### Database Indexing
Ensure indexes exist on:
- `users.email` (unique)
- `api_keys.hashed_key` (indexed)
- `analyses.user_id` (indexed)
- `analyses.status` (indexed)
- `analyses.created_at` (indexed)

## 📝 Common Issues & Solutions

### Issue: Import errors on startup
**Solution**: Verify all dependencies in `requirements.txt` are installed
```bash
pip install -r requirements.txt --no-cache-dir
```

### Issue: Alembic migration fails
**Solution**: Check current migration state
```bash
alembic current
alembic history
# Apply specific migration
alembic upgrade <revision>
```

### Issue: CORS errors in browser
**Solution**: Verify CORS_ORIGINS includes frontend URL
```bash
railway variables set CORS_ORIGINS='["https://app.splicr.bio","http://localhost:3000"]'
```

### Issue: Analysis stuck in QUEUED
**Solution**: 
1. Check Celery worker is running
2. Verify AWS Batch queue exists
3. Check job definition is valid

## 📚 Additional Resources

- [Railway Documentation](https://docs.railway.app/)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [Celery Documentation](https://docs.celeryq.dev/)
- [SQLAlchemy Documentation](https://docs.sqlalchemy.org/)
- [SplicR Architecture Docs](./docs/)
