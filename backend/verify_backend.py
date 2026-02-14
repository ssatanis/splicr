#!/usr/bin/env python3
"""
SplicR Backend Verification Script
Tests all critical backend functionality before and after deployment
"""

import os
import sys
import json
import requests
from typing import Dict, List, Tuple
import psycopg2
import redis
from datetime import datetime

# ANSI color codes
GREEN = '\033[92m'
RED = '\033[91m'
YELLOW = '\033[93m'
BLUE = '\033[94m'
RESET = '\033[0m'
BOLD = '\033[1m'

class BackendVerifier:
    def __init__(self, base_url: str = None):
        self.base_url = base_url or os.getenv('BACKEND_URL', 'http://localhost:8000')
        self.database_url = os.getenv('DATABASE_URL')
        self.redis_url = os.getenv('REDIS_URL')
        self.results: List[Tuple[str, bool, str]] = []
        
    def print_header(self, text: str):
        """Print formatted header"""
        print(f"\n{BOLD}{BLUE}{'='*60}{RESET}")
        print(f"{BOLD}{BLUE}{text:^60}{RESET}")
        print(f"{BOLD}{BLUE}{'='*60}{RESET}\n")
        
    def print_test(self, name: str, passed: bool, message: str = ""):
        """Print test result"""
        status = f"{GREEN}✓ PASS{RESET}" if passed else f"{RED}✗ FAIL{RESET}"
        print(f"{status} {name}")
        if message:
            prefix = "     " if passed else f"{RED}     ERROR:{RESET}"
            print(f"{prefix} {message}")
        self.results.append((name, passed, message))
        
    def test_database_connection(self) -> bool:
        """Test PostgreSQL database connection"""
        try:
            conn = psycopg2.connect(self.database_url)
            cursor = conn.cursor()
            cursor.execute("SELECT version();")
            version = cursor.fetchone()[0]
            cursor.close()
            conn.close()
            self.print_test("Database Connection", True, f"PostgreSQL {version.split()[1]}")
            return True
        except Exception as e:
            self.print_test("Database Connection", False, str(e))
            return False
            
    def test_database_tables(self) -> bool:
        """Verify critical database tables exist"""
        required_tables = [
            'users', 'api_keys', 'analyses',
            'tx_genes_master', 'tx_txscore_cache',
            'reference_gene_sets', 'reference_genes'
        ]
        
        try:
            conn = psycopg2.connect(self.database_url)
            cursor = conn.cursor()
            
            missing_tables = []
            for table in required_tables:
                cursor.execute(f"""
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables 
                        WHERE table_schema = 'public' 
                        AND table_name = '{table}'
                    );
                """)
                exists = cursor.fetchone()[0]
                if not exists:
                    missing_tables.append(table)
            
            cursor.close()
            conn.close()
            
            if missing_tables:
                self.print_test("Database Schema", False, 
                              f"Missing tables: {', '.join(missing_tables)}")
                return False
            else:
                self.print_test("Database Schema", True, 
                              f"All {len(required_tables)} required tables exist")
                return True
                
        except Exception as e:
            self.print_test("Database Schema", False, str(e))
            return False
            
    def test_redis_connection(self) -> bool:
        """Test Redis connection"""
        try:
            r = redis.from_url(self.redis_url)
            r.ping()
            info = r.info('server')
            self.print_test("Redis Connection", True, 
                          f"Redis {info['redis_version']}")
            return True
        except Exception as e:
            self.print_test("Redis Connection", False, str(e))
            return False
            
    def test_health_endpoint(self) -> bool:
        """Test /health endpoint"""
        try:
            response = requests.get(f"{self.base_url}/health", timeout=10)
            if response.status_code == 200:
                data = response.json()
                self.print_test("Health Endpoint", True, 
                              f"Status: {data.get('status')}")
                return True
            else:
                self.print_test("Health Endpoint", False, 
                              f"Status code: {response.status_code}")
                return False
        except Exception as e:
            self.print_test("Health Endpoint", False, str(e))
            return False
            
    def test_readiness_endpoint(self) -> bool:
        """Test /health/ready endpoint"""
        try:
            response = requests.get(f"{self.base_url}/health/ready", timeout=10)
            if response.status_code == 200:
                data = response.json()
                db_status = data.get('database', 'unknown')
                redis_status = data.get('redis', 'unknown')
                self.print_test("Readiness Check", True,
                              f"DB: {db_status}, Redis: {redis_status}")
                return True
            else:
                self.print_test("Readiness Check", False,
                              f"Status code: {response.status_code}")
                return False
        except Exception as e:
            self.print_test("Readiness Check", False, str(e))
            return False
            
    def test_api_docs(self) -> bool:
        """Test API documentation endpoints"""
        try:
            response = requests.get(f"{self.base_url}/docs", timeout=10)
            if response.status_code == 200 and 'swagger' in response.text.lower():
                self.print_test("API Documentation", True, "Swagger UI available")
                return True
            else:
                self.print_test("API Documentation", False,
                              f"Status: {response.status_code}")
                return False
        except Exception as e:
            self.print_test("API Documentation", False, str(e))
            return False
            
    def test_authentication(self) -> Tuple[bool, str]:
        """Test user registration and authentication"""
        # Generate unique email
        timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
        test_email = f"test_{timestamp}@splicr.test"
        test_password = "TestPassword123!"
        
        try:
            # Test registration
            register_response = requests.post(
                f"{self.base_url}/api/v1/auth/register",
                json={
                    "email": test_email,
                    "password": test_password,
                    "display_name": "Test User"
                },
                timeout=10
            )
            
            if register_response.status_code != 200:
                self.print_test("User Registration", False,
                              f"Status: {register_response.status_code}")
                return False, ""
                
            token_data = register_response.json()
            token = token_data.get('access_token')
            
            if not token:
                self.print_test("User Registration", False, "No token received")
                return False, ""
                
            self.print_test("User Registration", True, "User created successfully")
            
            # Test login
            login_response = requests.post(
                f"{self.base_url}/api/v1/auth/login",
                json={
                    "email": test_email,
                    "password": test_password
                },
                timeout=10
            )
            
            if login_response.status_code == 200:
                self.print_test("User Login", True, "Authentication successful")
                return True, token
            else:
                self.print_test("User Login", False,
                              f"Status: {login_response.status_code}")
                return False, ""
                
        except Exception as e:
            self.print_test("Authentication", False, str(e))
            return False, ""
            
    def test_tea_predictions(self, token: str) -> bool:
        """Test TEA (Therapeutic Editability Atlas) predictions"""
        test_sequence = "ACGTACGTACGTACGTACGTACG"
        
        try:
            # Test efficiency prediction
            eff_response = requests.post(
                f"{self.base_url}/api/v1/tea/predict/efficiency",
                json={"sequence": test_sequence, "model": "pridict"},
                headers={"Authorization": f"Bearer {token}"},
                timeout=10
            )
            
            if eff_response.status_code == 200:
                data = eff_response.json()
                score = data.get('efficiency_score', 0)
                self.print_test("TEA Efficiency Prediction", True,
                              f"Score: {score:.2f}, Model: {data.get('model')}")
            else:
                self.print_test("TEA Efficiency Prediction", False,
                              f"Status: {eff_response.status_code}")
                return False
                
            # Test off-target prediction
            off_response = requests.post(
                f"{self.base_url}/api/v1/tea/predict/off-targets",
                json={"sequence": test_sequence, "model": "cas9"},
                headers={"Authorization": f"Bearer {token}"},
                timeout=10
            )
            
            if off_response.status_code == 200:
                data = off_response.json()
                num_targets = len(data.get('targets', []))
                self.print_test("TEA Off-target Prediction", True,
                              f"Found {num_targets} potential off-targets")
                return True
            else:
                self.print_test("TEA Off-target Prediction", False,
                              f"Status: {off_response.status_code}")
                return False
                
        except Exception as e:
            self.print_test("TEA Predictions", False, str(e))
            return False
            
    def test_reference_gene_sets(self, token: str) -> bool:
        """Test reference gene set API"""
        try:
            response = requests.get(
                f"{self.base_url}/api/v1/reference-sets/stats",
                headers={"Authorization": f"Bearer {token}"},
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                self.print_test("Reference Gene Sets", True,
                              f"Categories: {data.get('categories_count', 0)}, "
                              f"Sets: {data.get('gene_sets_count', 0)}, "
                              f"Genes: {data.get('total_genes', 0)}")
                return True
            else:
                self.print_test("Reference Gene Sets", False,
                              f"Status: {response.status_code}")
                return False
        except Exception as e:
            self.print_test("Reference Gene Sets", False, str(e))
            return False
            
    def test_file_upload_presigned_url(self, token: str) -> bool:
        """Test presigned URL generation for file upload"""
        try:
            response = requests.post(
                f"{self.base_url}/api/v1/upload/presigned-url",
                json={
                    "filename": "test.fastq.gz",
                    "file_type": "application/gzip"
                },
                headers={"Authorization": f"Bearer {token}"},
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                self.print_test("Presigned URL Generation", True,
                              f"URL generated, expires in {data.get('expires_in')}s")
                return True
            else:
                self.print_test("Presigned URL Generation", False,
                              f"Status: {response.status_code}")
                return False
        except Exception as e:
            self.print_test("Presigned URL Generation", False, str(e))
            return False
            
    def print_summary(self):
        """Print test summary"""
        self.print_header("TEST SUMMARY")
        
        total = len(self.results)
        passed = sum(1 for _, p, _ in self.results if p)
        failed = total - passed
        
        print(f"Total Tests: {total}")
        print(f"{GREEN}Passed: {passed}{RESET}")
        print(f"{RED}Failed: {failed}{RESET}")
        print(f"Success Rate: {(passed/total*100):.1f}%\n")
        
        if failed > 0:
            print(f"{RED}{BOLD}FAILED TESTS:{RESET}")
            for name, success, message in self.results:
                if not success:
                    print(f"  {RED}✗{RESET} {name}: {message}")
            print()
            
        return failed == 0
        
    def run_all_tests(self):
        """Run all verification tests"""
        self.print_header("SPLICR BACKEND VERIFICATION")
        print(f"Backend URL: {self.base_url}")
        print(f"Database: {self.database_url[:30]}...")
        print(f"Redis: {self.redis_url[:30]}...")
        
        # Infrastructure tests
        self.print_header("INFRASTRUCTURE TESTS")
        db_ok = self.test_database_connection()
        if db_ok:
            self.test_database_tables()
        self.test_redis_connection()
        
        # API tests
        self.print_header("API HEALTH TESTS")
        self.test_health_endpoint()
        self.test_readiness_endpoint()
        self.test_api_docs()
        
        # Authentication tests
        self.print_header("AUTHENTICATION TESTS")
        auth_ok, token = self.test_authentication()
        
        # Feature tests (requires authentication)
        if auth_ok and token:
            self.print_header("FEATURE TESTS")
            self.test_tea_predictions(token)
            self.test_reference_gene_sets(token)
            self.test_file_upload_presigned_url(token)
        else:
            print(f"{YELLOW}⚠ Skipping feature tests (authentication failed){RESET}\n")
        
        # Print summary
        success = self.print_summary()
        
        return 0 if success else 1


def main():
    """Main entry point"""
    import argparse
    
    parser = argparse.ArgumentParser(
        description='Verify SplicR backend functionality'
    )
    parser.add_argument(
        '--url',
        default=os.getenv('BACKEND_URL', 'http://localhost:8000'),
        help='Backend URL (default: http://localhost:8000)'
    )
    
    args = parser.parse_args()
    
    # Check environment variables
    if not os.getenv('DATABASE_URL'):
        print(f"{RED}ERROR: DATABASE_URL environment variable not set{RESET}")
        sys.exit(1)
        
    if not os.getenv('REDIS_URL'):
        print(f"{RED}ERROR: REDIS_URL environment variable not set{RESET}")
        sys.exit(1)
    
    verifier = BackendVerifier(base_url=args.url)
    sys.exit(verifier.run_all_tests())


if __name__ == '__main__':
    main()
