# SplicR Python SDK

Client for the SplicR CRISPR screen analysis API.

## Install

```bash
pip install requests
# Or add to your project: requests>=2.28.0
```

Copy `splicr/` into your project or install in development:

```bash
pip install -e .
```

(Add a minimal `setup.py` or `pyproject.toml` if you want a package.)

## Usage

```python
from splicr import SplicRClient

client = SplicRClient(api_key="sk_live_...", base_url="http://localhost:3000")

# Create analysis (metadata only; upload FASTQ via UI or upload API)
analysis = client.create_analysis(
    name="My Screen",
    library="brunello",
    method="mageck",
    fastq_files=["control.fastq", "treatment.fastq"],
)

# Run BAGEL2 on an existing analysis (after main pipeline has run)
bagel_result = client.run_bagel2(analysis["id"])

# Get results
results = client.get_results(analysis["id"])

# List analyses
analyses = client.list_analyses()

# Templates
templates = client.list_templates()
params = client.use_template("methods-section-template")
```

## API key

Generate an API key in **Settings → Developer & API** in the SplicR UI. Send it as:

```
Authorization: Bearer sk_live_...
```

## Rate limits

Standard: 100 requests/minute. Configure `API_RATE_LIMIT_*` on the server.
