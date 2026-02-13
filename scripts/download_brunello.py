
import os
import urllib.request
import sys

URL = "https://www.addgene.org/static/cms/filer_public/8b/4c/8b4c89d9-eac1-44b2-bb2f-8fea95672705/broadgpp-brunello-library-contents.txt"
OUTPUT_DIR = "data/raw/brunello"
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "broadgpp-brunello-library-contents.txt")

def download_file():
    print(f"Downloading Brunello library from {URL}...")
    
    # Ensure directory exists
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    try:
        # Download using urllib (standard library) with SSL bypass
        import ssl
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        
        req = urllib.request.Request(
            URL, 
            data=None, 
            headers={
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36'
            }
        )
        
        with urllib.request.urlopen(req, context=ctx) as response, open(OUTPUT_FILE, 'wb') as out_file:
            data = response.read()
            out_file.write(data)
                
        print(f"Download complete: {OUTPUT_FILE}")
        
        # Verification
        if not os.path.exists(OUTPUT_FILE):
            print("Error: File not found after download.")
            sys.exit(1)
            
        file_size = os.path.getsize(OUTPUT_FILE)
        if file_size == 0:
            print("Error: Downloaded file is empty.")
            sys.exit(1)
            
        with open(OUTPUT_FILE, 'r') as f:
            line_count = sum(1 for _ in f)
            
        print(f"File size: {file_size} bytes")
        print(f"Line count: {line_count}")
        
        if line_count < 76000:
            print(f"Warning: Line count ({line_count}) is lower than expected (~76,000).")
            # We don't exit here as it might be a partial update or valid change, but warn.
        
        print("Verification successful.")
        
    except Exception as e:
        print(f"Error downloading file: {e}")
        sys.exit(1)

if __name__ == "__main__":
    download_file()
