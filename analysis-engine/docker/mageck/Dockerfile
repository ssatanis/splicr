FROM python:3.10-slim

LABEL maintainer="SplicR Team"
LABEL description="MAGeCK CRISPR screen analysis"

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    wget \
    gcc \
    g++ \
    gfortran \
    libopenblas-dev \
    liblapack-dev \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install MAGeCK and dependencies
RUN pip install --no-cache-dir \
    mageck==0.5.9.5 \
    pandas>=2.0.0 \
    numpy>=1.24.0 \
    scipy>=1.11.0 \
    matplotlib>=3.7.0 \
    seaborn>=0.12.0 \
    boto3>=1.34.0 \
    requests>=2.31.0

WORKDIR /analysis

# Copy scripts
COPY entrypoint.sh /entrypoint.sh
COPY run_mageck.py /analysis/run_mageck.py
COPY progress_reporter.py /analysis/progress_reporter.py
COPY progress_parser.py /analysis/progress_parser.py

RUN chmod +x /entrypoint.sh && \
    chmod +x /analysis/run_mageck.py

ENTRYPOINT ["/entrypoint.sh"]
