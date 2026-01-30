FROM python:3.10-slim

LABEL maintainer="SplicR Team"
LABEL description="DrugZ CRISPR screen analysis"

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    wget \
    git \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Install DrugZ and dependencies
RUN pip install --no-cache-dir \
    pandas>=2.0.0 \
    numpy>=1.24.0 \
    scipy>=1.11.0 \
    matplotlib>=3.7.0 \
    boto3>=1.34.0 \
    requests>=2.31.0

# Clone DrugZ repository
RUN git clone https://github.com/hart-lab/drugz.git /drugz && \
    cd /drugz && \
    chmod +x drugz.py

WORKDIR /analysis

# Copy scripts
COPY entrypoint.sh /entrypoint.sh
COPY run_drugz.py /analysis/run_drugz.py
COPY progress_reporter.py /analysis/progress_reporter.py

RUN chmod +x /entrypoint.sh && \
    chmod +x /analysis/run_drugz.py

ENV PATH="/drugz:${PATH}"

ENTRYPOINT ["/entrypoint.sh"]
