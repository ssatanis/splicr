# 🚀 SplicR Backend - Production Deployment Guide

## Quick Start Checklist

- [ ] Environment variables configured
- [ ] Database migrated
- [ ] Redis connected  
- [ ] R2/S3 storage configured
- [ ] Railway project linked
- [ ] Domain configured (optional)
- [ ] Monitoring enabled

## 📋 Prerequisites

### Required Services

1. **Supabase PostgreSQL Database**
   - Project: https://supabase.com/dashboard/project/bxfrhmvkylipqdtoehii
   - Database URL with pooler: `postgresql://postgres.bxfrhmvkylipqdtoehii:PASSWORD@aws-0-us-east-1.pooler.supabase.com:6543/postgres`

2. **Upstash Redis Queue**
   - Database: splicr-queue
   - Endpoint: `striking-wallaby-46693.upstash.io`
   - Port: 6379 (with TLS)

3. **Cloudflare R2 Storage**
   - Account ID: `da0ccf4b112f1383afdb6cf7be726dde`
   - Bucket: `splicr-fastq-files`
   - Endpoint: `https://da0ccf4b112f1383afdb6cf7be726dde.r2.cloudflarestorage.com`

4. **Railway Platform**
   - Project ID: `d57231af-7a86-4491-a1ae-8faf503e3a50`
   - Service: `splicr`

## 🛠️ Setup Steps

### 1. Clone and Prepare Repository

```bash
git clone https://github.com/ssatanis/splicr.git
cd splicr/backend
```

### 2. Validate Environment

```bash
# Copy environment template
cp ../.env.railway.production .env

# Edit .env and fill in values:
# - SUPABASE_DB_PASSWORD
# - SECRET_KEY (generate with: openssl rand -hex 32)

# Validate configuration
./validate_env.sh
```

Expected output: All checks should pass ✓

### 3. Run Database Migrations

```bash
# Install dependencies
pip install -r requirements.txt

# Run migrations
alembic upgrade head
```

### 4. Test Locally (Optional)

```bash
# Start the server
python -m uvicorn app.main:app --reload

# In another terminal, run verification
python verify_backend.py --url http://localhost:8000
```

### 5. Deploy to Railway

#### Option A: Automatic Deployment (Recommended)

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Link to project
railway link d57231af-7a86-4491-a1ae-8faf503e3a50

# Set environment variables
railway variables set SECRET_KEY="$(openssl rand -hex 32)"
railway variables set DATABASE_URL="postgresql://postgres.bxfrhmvkylipqdtoehii:PASSWORD@..."
railway variables set REDIS_URL="redis://default:TOKEN@striking-wallaby-46693.upstash.io:6379"
# ... (copy all variables from .env.railway.production)

# Deploy
railway up
```

#### Option B: GitHub Integration

1. Push code to GitHub:
   ```bash
   git add .
   git commit -m "Deploy backend to Railway"
   git push origin main
   ```

2. In Railway Dashboard:
   - Go to https://railway.app/project/d57231af-7a86-4491-a1ae-8faf503e3a50
   - Connect to GitHub repository
   - Select `backend/` as root directory
   - Railway will auto-deploy on push

### 6. Verify Deployment

```bash
# Get deployment URL from Railway dashboard
export BACKEND_URL="https://splicr-production.up.railway.app"

# Run verification script
python verify_backend.py --url $BACKEND_URL
```

Expected: All tests should pass ✓

## 🔑 Environment Variables Reference

### Critical Variables (MUST SET)

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection | `postgresql://user:pass@host:5432/db` |
| `REDIS_URL` | Redis connection | `redis://default:token@host:6379` |
| `SECRET_KEY` | JWT signing key (64 chars) | `openssl rand -hex 32` |
| `S3_BUCKET_NAME` | R2 bucket name | `splicr-fastq-files` |
| `AWS_ACCESS_KEY_ID` | R2 access key | `e89d9b7135688320...` |
| `AWS_SECRET_ACCESS_KEY` | R2 secret key | `acb510ed0fe1c1e9...` |
| `R2_ENDPOINT_URL` | Cloudflare R2 endpoint | `https://ACCOUNT_ID.r2.cloudflarestorage.com` |

### Optional Variables (Recommended)

| Variable | Default | Description |
|----------|---------|-------------|
| `WORKERS` | 2 | Number of Uvicorn workers |
| `PORT` | 8000 | Server port (auto-set by Railway) |
| `CORS_ORIGINS` | `["http://localhost:3000"]` | Allowed CORS origins (JSON array) |
| `DEBUG` | `false` | Enable debug mode |
| `AWS_BATCH_JOB_QUEUE` | - | AWS Batch queue (if using) |
| `AWS_BATCH_JOB_DEFINITION` | - | AWS Batch job definition |

## 📊 Post-Deployment Tasks

### 1. Configure Domain (Optional)

```bash
railway domain add splicr-api.yourdomain.com
```

Update `CORS_ORIGINS` to include your domain:
```bash
railway variables set CORS_ORIGINS='["https://app.splicr.bio","https://www.splicr.bio"]'
```

### 2. Enable Monitoring

- Set up Railway metrics dashboard
- Configure log aggregation
- Set up alerts for errors

### 3. Load Reference Data

```bash
# SSH into Railway service or run locally pointing to production DB
cd tea_pipeline
python run_pipeline.py
```

This loads:
- Tissue & cancer metadata
- Gene master table
- DepMap data
- GTEx expression data
- gnomAD constraints
- ClinVar variants
- DGIdb drug interactions
- AlphaFold structures
- TxScore calculations

Expected time: 2-6 hours depending on data size

### 4. Test Complete Workflow

```bash
# Create test user
curl -X POST $BACKEND_URL/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test1234!","display_name":"Test User"}'

# Test TEA prediction
TOKEN="your_access_token"
curl -X POST $BACKEND_URL/api/v1/tea/predict/efficiency \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sequence":"ACGTACGTACGTACGTACGTACG","model":"pridict"}'

# Test reference gene sets
curl -X GET $BACKEND_URL/api/v1/reference-sets/stats \
  -H "Authorization: Bearer $TOKEN"
```

## 🔍 Monitoring & Debugging

### View Logs

```bash
# Via Railway CLI
railway logs

# Via Railway Dashboard
# https://railway.app/project/d57231af-7a86-4491-a1ae-8faf503e3a50/service/splicr → Logs
```

### Check Health

```bash
# Basic health
curl $BACKEND_URL/health

# Readiness (DB + Redis)
curl $BACKEND_URL/health/ready

# Liveness
curl $BACKEND_URL/health/live
```

### Database Queries

```bash
# Connect to database
psql $DATABASE_URL

# Check recent analyses
SELECT id, status, progress, created_at FROM analyses ORDER BY created_at DESC LIMIT 10;

# Check users
SELECT id, email, created_at FROM users ORDER BY created_at DESC;

# Check TxScore cache
SELECT COUNT(*) FROM tx_txscore_cache;
```

### Redis Queue Status

```bash
redis-cli -u $REDIS_URL INFO stats
redis-cli -u $REDIS_URL KEYS "celery-task-meta-*"
```

## 🐛 Common Issues & Solutions

### Database Connection Errors

**Symptom**: `connection to server ... failed`

**Solutions**:
1. Check DATABASE_URL format
2. Verify Supabase project is active
3. Use pooler URL (port 6543) not direct (port 5432)
4. Check firewall rules

```bash
# Test connection
psql "$DATABASE_URL" -c "SELECT 1"
```

### Redis Connection Timeouts

**Symptom**: `Error connecting to Redis`

**Solutions**:
1. Verify Upstash database is active
2. Check REDIS_URL uses correct protocol (`redis://` or `rediss://`)
3. Verify token is correct
4. Check network connectivity

```bash
# Test connection
redis-cli -u "$REDIS_URL" PING
```

### R2/S3 Access Denied

**Symptom**: `Access Denied` or `403 Forbidden`

**Solutions**:
1. Verify bucket exists
2. Check access key permissions
3. Verify R2_ENDPOINT_URL format
4. Check CORS settings on R2 bucket

```bash
# Test with AWS CLI
aws s3 ls s3://splicr-fastq-files --endpoint-url=$R2_ENDPOINT_URL
```

### Application Won't Start

**Symptom**: Crash loop or immediate exit

**Solutions**:
1. Check Railway logs for error messages
2. Verify all required environment variables are set
3. Check SECRET_KEY is set
4. Verify database migrations are applied

```bash
# Check which variables are missing
railway variables
```

## 🔐 Security Checklist

- [ ] SECRET_KEY is secure (64+ characters, random)
- [ ] Database password is strong
- [ ] Redis token is not exposed
- [ ] R2 access keys are not committed to Git
- [ ] CORS_ORIGINS only includes trusted domains
- [ ] HTTPS is enforced (Railway provides this automatically)
- [ ] API rate limiting is configured (future enhancement)
- [ ] Database SSL is enabled
- [ ] Redis TLS is enabled

## 📈 Performance Tuning

### Recommended Railway Configuration

- **Memory**: 4GB
- **CPUs**: 2 vCPUs
- **Workers**: 4 (set WORKERS=4)
- **Autoscaling**: Enable horizontal scaling

### Database Optimization

```sql
-- Add indexes
CREATE INDEX IF NOT EXISTS idx_analyses_user_id ON analyses(user_id);
CREATE INDEX IF NOT EXISTS idx_analyses_status ON analyses(status);
CREATE INDEX IF NOT EXISTS idx_analyses_created_at ON analyses(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_keys_hashed_key ON api_keys(hashed_key);

-- Analyze tables
ANALYZE users;
ANALYZE api_keys;
ANALYZE analyses;
ANALYZE tx_txscore_cache;
```

### Connection Pooling

Already configured in `app/database.py`:
- Pool size: 10
- Max overflow: 20
- Pool pre-ping: Enabled

## 📚 Additional Resources

- [Railway Documentation](https://docs.railway.app/)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [Supabase Documentation](https://supabase.com/docs)
- [Upstash Documentation](https://docs.upstash.com/redis)
- [Cloudflare R2 Documentation](https://developers.cloudflare.com/r2/)

## 🆘 Support

If you encounter issues:

1. Check Railway logs: `railway logs`
2. Run verification: `python verify_backend.py --url $BACKEND_URL`
3. Check database connectivity: `psql $DATABASE_URL -c "SELECT 1"`
4. Check Redis: `redis-cli -u $REDIS_URL PING`
5. Review deployment guide: `RAILWAY_DEPLOYMENT.md`

## 📝 Next Steps

After successful deployment:

1. ✅ Configure frontend to use new backend URL
2. ✅ Set up monitoring and alerts
3. ✅ Load reference gene sets and TxScore data
4. ✅ Test complete CRISPR analysis workflow
5. ✅ Set up backup strategy for database
6. ✅ Configure CI/CD for automatic deployments
7. ✅ Set up staging environment

---

**Deployment Status**: Ready ✓  
**Last Updated**: 2026-02-14  
**Version**: 1.0.0
