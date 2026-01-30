FROM python:3.10-slim

LABEL maintainer="SplicR Team"
LABEL description="Next-generation CRISPR screen analysis platform."

# Install system dependencies including fonts for publication
RUN apt-get update && apt-get install -y \
    build-essential \
    wget \
    gcc \
    fonts-liberation \
    fonts-dejavu-core \
    fontconfig \
    && rm -rf /var/lib/apt/lists/*

# Install Python packages for visualization
RUN pip install --no-cache-dir \
    pandas>=2.0.0 \
    numpy>=1.24.0 \
    matplotlib>=3.7.0 \
    seaborn>=0.12.0 \
    plotly>=5.18.0 \
    scipy>=1.11.0 \
    scikit-learn>=1.3.0 \
    boto3>=1.34.0 \
    requests>=2.31.0 \
    pillow>=10.0.0 \
    adjustText>=0.8

# Rebuild font cache
RUN fc-cache -f -v

WORKDIR /analysis

# Copy scripts
COPY generate_figures.py /analysis/generate_figures.py
COPY progress_reporter.py /analysis/progress_reporter.py

RUN chmod +x /analysis/generate_figures.py

ENTRYPOINT ["python3", "/analysis/generate_figures.py"]
