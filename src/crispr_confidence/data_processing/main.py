"""
Main orchestrator for data processing.
"""
from .string_db import process_string
from .bagel import process_bagel
from .pathways import process_pathways
from .depmap import process_depmap

def run_all():
    print("=" * 60)
    print("RUNNING DATA PROCESSING PIPELINES")
    print("=" * 60 + "\n")
    
    results = {
        "STRING": process_string(),
        "BAGEL": process_bagel(),
        "PATHWAYS": process_pathways(),
        "DEPMAP": process_depmap()
    }
    
    print("\n" + "-" * 60)
    print("SUMMARY")
    print("-" * 60)
    success = True
    for name, result in results.items():
        status = "✓" if result else "✗"
        print(f"{status} {name}")
        if not result:
            success = False
            
    if not success:
        print("\n⚠ Some processors failed.")
        
if __name__ == "__main__":
    run_all()
