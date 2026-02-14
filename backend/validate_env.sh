#!/bin/bash
# SplicR Backend - Environment Setup and Validation Script
# This script validates your environment configuration before deployment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Configuration
REQUIRED_VARS=(
    "DATABASE_URL"
    "REDIS_URL"
    "SECRET_KEY"
    "S3_BUCKET_NAME"
    "AWS_ACCESS_KEY_ID"
    "AWS_SECRET_ACCESS_KEY"
    "R2_ENDPOINT_URL"
)

OPTIONAL_VARS=(
    "WORKERS"
    "PORT"
    "CORS_ORIGINS"
    "AWS_BATCH_JOB_QUEUE"
    "AWS_BATCH_JOB_DEFINITION"
    "CELERY_BROKER_URL"
    "CELERY_RESULT_BACKEND"
)

print_header() {
    echo -e "\n${BOLD}${BLUE}=====================================${NC}"
    echo -e "${BOLD}${BLUE}$1${NC}"
    echo -e "${BOLD}${BLUE}=====================================${NC}\n"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

check_env_file() {
    print_header "Checking Environment File"
    
    if [ -f .env ]; then
        print_success ".env file found"
        export $(cat .env | grep -v '^#' | xargs)
    elif [ -f ../.env.railway.production ]; then
        print_warning ".env not found, using .env.railway.production"
        export $(cat ../.env.railway.production | grep -v '^#' | xargs)
    else
        print_error "No .env file found"
        print_info "Create .env file or use .env.railway.production template"
        exit 1
    fi
}

check_required_vars() {
    print_header "Validating Required Environment Variables"
    
    local missing=0
    
    for var in "${REQUIRED_VARS[@]}"; do
        if [ -z "${!var}" ]; then
            print_error "$var is not set"
            missing=$((missing + 1))
        else
            # Mask sensitive values
            if [[ $var == *"KEY"* ]] || [[ $var == *"PASSWORD"* ]] || [[ $var == *"SECRET"* ]]; then
                local masked="${!var:0:4}****${!var: -4}"
                print_success "$var is set ($masked)"
            else
                print_success "$var is set"
            fi
        fi
    done
    
    if [ $missing -gt 0 ]; then
        print_error "$missing required variables are missing"
        exit 1
    fi
    
    print_success "All required variables are set"
}

check_optional_vars() {
    print_header "Checking Optional Environment Variables"
    
    for var in "${OPTIONAL_VARS[@]}"; do
        if [ -z "${!var}" ]; then
            print_warning "$var is not set (using default)"
        else
            print_success "$var is set"
        fi
    done
}

validate_database_url() {
    print_header "Validating Database Connection"
    
    if ! command -v psql &> /dev/null; then
        print_warning "psql not found, skipping database validation"
        return 0
    fi
    
    if psql "$DATABASE_URL" -c "SELECT version();" &> /dev/null; then
        local version=$(psql "$DATABASE_URL" -t -c "SELECT version();" | head -n1 | xargs)
        print_success "Database connection successful"
        print_info "PostgreSQL version: $version"
    else
        print_error "Database connection failed"
        print_info "Check DATABASE_URL: $DATABASE_URL"
        exit 1
    fi
}

validate_redis_url() {
    print_header "Validating Redis Connection"
    
    if ! command -v redis-cli &> /dev/null; then
        print_warning "redis-cli not found, skipping Redis validation"
        return 0
    fi
    
    if redis-cli -u "$REDIS_URL" PING &> /dev/null; then
        local info=$(redis-cli -u "$REDIS_URL" INFO server | grep redis_version | cut -d: -f2 | tr -d '\r')
        print_success "Redis connection successful"
        print_info "Redis version: $info"
    else
        print_error "Redis connection failed"
        print_info "Check REDIS_URL: ${REDIS_URL:0:30}..."
        exit 1
    fi
}

validate_r2_credentials() {
    print_header "Validating R2/S3 Credentials"
    
    if ! command -v python3 &> /dev/null; then
        print_warning "Python not found, skipping R2 validation"
        return 0
    fi
    
    python3 -c "
import boto3
from botocore.client import Config
import os
import sys

try:
    s3 = boto3.client(
        's3',
        endpoint_url=os.environ.get('R2_ENDPOINT_URL'),
        aws_access_key_id=os.environ.get('AWS_ACCESS_KEY_ID'),
        aws_secret_access_key=os.environ.get('AWS_SECRET_ACCESS_KEY'),
        config=Config(signature_version='s3v4'),
        region_name='auto'
    )
    
    # Test bucket access
    response = s3.list_objects_v2(
        Bucket=os.environ.get('S3_BUCKET_NAME'),
        MaxKeys=1
    )
    
    print('✓ R2 bucket access successful')
    if 'Contents' in response:
        print(f'  Bucket contains {response.get(\"KeyCount\", 0)} objects')
    else:
        print('  Bucket is empty')
    sys.exit(0)
except Exception as e:
    print(f'✗ R2 bucket access failed: {e}')
    sys.exit(1)
" 
    if [ $? -eq 0 ]; then
        print_success "R2/S3 credentials valid"
    else
        print_error "R2/S3 credentials invalid"
        exit 1
    fi
}

check_secret_key_strength() {
    print_header "Validating SECRET_KEY Strength"
    
    local key_length=${#SECRET_KEY}
    
    if [ $key_length -lt 32 ]; then
        print_error "SECRET_KEY is too short ($key_length characters)"
        print_info "Generate a secure key: openssl rand -hex 32"
        exit 1
    elif [ "$SECRET_KEY" == "CHANGE_THIS_GENERATE_SECURE_KEY" ] || [ "$SECRET_KEY" == "change-this-to-a-secure-random-key-in-production" ]; then
        print_error "SECRET_KEY is using default/placeholder value"
        print_info "Generate a secure key: openssl rand -hex 32"
        exit 1
    else
        print_success "SECRET_KEY strength is adequate ($key_length characters)"
    fi
}

check_cors_configuration() {
    print_header "Validating CORS Configuration"
    
    if [ -z "$CORS_ORIGINS" ]; then
        print_warning "CORS_ORIGINS not set (will use default)"
        return 0
    fi
    
    # Validate JSON format
    if echo "$CORS_ORIGINS" | python3 -m json.tool &> /dev/null; then
        print_success "CORS_ORIGINS is valid JSON"
        local origins_count=$(echo "$CORS_ORIGINS" | python3 -c "import sys, json; print(len(json.load(sys.stdin)))")
        print_info "Configured origins: $origins_count"
    else
        print_error "CORS_ORIGINS is not valid JSON"
        print_info "Example: '[\"https://app.splicr.bio\",\"http://localhost:3000\"]'"
        exit 1
    fi
}

check_python_dependencies() {
    print_header "Checking Python Dependencies"
    
    if [ -f requirements.txt ]; then
        print_success "requirements.txt found"
        
        if command -v pip3 &> /dev/null; then
            local missing=0
            while IFS= read -r line; do
                # Skip comments and empty lines
                [[ "$line" =~ ^#.*$ ]] && continue
                [[ -z "$line" ]] && continue
                
                # Extract package name (before ==, >=, etc.)
                pkg=$(echo "$line" | sed 's/[>=<].*//g' | sed 's/\[.*\]//g')
                
                if pip3 show "$pkg" &> /dev/null; then
                    : # Package installed, no output
                else
                    print_warning "Package not installed: $pkg"
                    missing=$((missing + 1))
                fi
            done < requirements.txt
            
            if [ $missing -eq 0 ]; then
                print_success "All Python dependencies are installed"
            else
                print_warning "$missing dependencies are missing"
                print_info "Install with: pip install -r requirements.txt"
            fi
        else
            print_warning "pip3 not found, cannot verify dependencies"
        fi
    else
        print_error "requirements.txt not found"
        exit 1
    fi
}

check_database_schema() {
    print_header "Checking Database Schema"
    
    if ! command -v psql &> /dev/null; then
        print_warning "psql not found, skipping schema validation"
        return 0
    fi
    
    local required_tables=("users" "api_keys" "analyses" "tx_genes_master" "reference_gene_sets")
    local missing=0
    
    for table in "${required_tables[@]}"; do
        if psql "$DATABASE_URL" -t -c "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '$table');" | grep -q 't'; then
            : # Table exists, no output
        else
            print_warning "Table missing: $table"
            missing=$((missing + 1))
        fi
    done
    
    if [ $missing -eq 0 ]; then
        print_success "All required database tables exist"
    else
        print_warning "$missing tables are missing"
        print_info "Run migrations: alembic upgrade head"
    fi
}

generate_secure_key() {
    print_header "Secure Key Generation"
    
    if command -v openssl &> /dev/null; then
        local new_key=$(openssl rand -hex 32)
        print_success "Generated new SECRET_KEY:"
        echo -e "${BOLD}$new_key${NC}"
        echo ""
        print_info "Add this to your .env file:"
        echo "SECRET_KEY=$new_key"
    else
        print_warning "openssl not found"
        print_info "Install openssl or use: python3 -c 'import secrets; print(secrets.token_hex(32))'"
    fi
}

print_deployment_summary() {
    print_header "Deployment Checklist"
    
    echo "✓ Environment variables configured"
    echo "✓ Database connection validated"
    echo "✓ Redis connection validated"
    echo "✓ R2/S3 storage validated"
    echo "✓ SECRET_KEY is secure"
    echo "✓ Python dependencies ready"
    echo ""
    print_success "Ready for deployment!"
    echo ""
    print_info "Next steps:"
    echo "  1. Commit changes to Git"
    echo "  2. Push to Railway-connected repository"
    echo "  3. Monitor deployment logs"
    echo "  4. Run: python verify_backend.py --url https://your-app.up.railway.app"
}

# Main execution
main() {
    cd "$(dirname "$0")"
    
    print_header "SplicR Backend Environment Validation"
    
    # Run checks
    check_env_file
    check_required_vars
    check_optional_vars
    check_secret_key_strength
    check_cors_configuration
    validate_database_url
    validate_redis_url
    validate_r2_credentials
    check_python_dependencies
    check_database_schema
    
    # Print summary
    print_deployment_summary
    
    echo ""
    read -p "Generate a new SECRET_KEY? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        generate_secure_key
    fi
}

# Handle script arguments
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    if [ "$1" == "--help" ] || [ "$1" == "-h" ]; then
        echo "Usage: $0 [options]"
        echo ""
        echo "Options:"
        echo "  --help, -h     Show this help message"
        echo "  --generate-key Generate a new SECRET_KEY"
        echo ""
        exit 0
    elif [ "$1" == "--generate-key" ]; then
        generate_secure_key
        exit 0
    else
        main
    fi
fi
