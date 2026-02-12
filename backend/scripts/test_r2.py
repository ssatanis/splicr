#!/usr/bin/env python3
"""Test R2 connection and configuration"""
import sys
sys.path.insert(0, '/Users/sahaj/Documents/Projects/SplicR/backend')

from app.config import get_settings
from app.services.s3_service import S3Service

def test_config():
    """Test R2 configuration"""
    print("=" * 60)
    print("Testing R2 Configuration")
    print("=" * 60)
    
    s = get_settings()
    print(f"\n✓ R2 Endpoint: {s.R2_ENDPOINT_URL}")
    print(f"✓ Bucket Name: {s.S3_BUCKET_NAME}")
    print(f"✓ Region: {s.AWS_REGION}")
    print(f"✓ Access Key ID: {s.AWS_ACCESS_KEY_ID[:10]}...")
    print("\n✓ Configuration loaded successfully!")
    
def test_connection():
    """Test R2 connection"""
    print("\n" + "=" * 60)
    print("Testing R2 Connection")
    print("=" * 60)
    
    try:
        print("\nListing files in R2 bucket...")
        files = S3Service.list_files('', max_keys=10)
        
        print(f"\n✓ Successfully connected to R2!")
        print(f"✓ Found {len(files)} existing files in bucket")
        
        if files:
            print("\nExisting files:")
            for f in files[:5]:
                print(f"  - {f}")
        else:
            print("\n(No files in bucket yet - this is fine for a fresh setup)")
            
        return True
    except Exception as e:
        print(f"\n✗ Connection failed: {str(e)}")
        print("\nPlease verify:")
        print("  1. R2 credentials are correct")
        print("  2. Bucket name matches your R2 bucket")
        print("  3. R2 endpoint URL is correct")
        return False

def test_presigned_url():
    """Test presigned URL generation"""
    print("\n" + "=" * 60)
    print("Testing Presigned URL Generation")
    print("=" * 60)
    
    try:
        result = S3Service.generate_presigned_upload_url(
            filename="test.fastq",
            file_type="application/octet-stream"
        )
        
        print("\n✓ Presigned URL generated successfully!")
        print(f"\n  Upload URL: {result['upload_url'][:80]}...")
        print(f"  File Key: {result['file_key']}")
        print(f"  Expires In: {result['expires_in']} seconds")
        
        # Verify URL points to R2
        if 'r2.cloudflarestorage.com' in result['upload_url']:
            print("\n✓ URL correctly points to Cloudflare R2")
        else:
            print(f"\n⚠ Warning: URL may not point to R2: {result['upload_url']}")
            
        return True
    except Exception as e:
        print(f"\n✗ Presigned URL generation failed: {str(e)}")
        return False

if __name__ == "__main__":
    print("\n🧪 SplicR R2 Storage Test Suite\n")
    
    try:
        # Test 1: Configuration
        test_config()
        
        # Test 2: Connection
        connection_ok = test_connection()
        
        # Test 3: Presigned URL
        if connection_ok:
            test_presigned_url()
        
        print("\n" + "=" * 60)
        print("✓ All tests completed!")
        print("=" * 60)
        print("\nNext steps:")
        print("  1. Start the backend API")
        print("  2. Upload a FASTQ file from the frontend")
        print("  3. Check R2 dashboard to confirm file appears")
        print()
        
    except Exception as e:
        print(f"\n\n✗ Test suite failed: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
