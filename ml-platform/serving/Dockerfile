# Djir Smart Pricing API — portable serving container.
#
# Build & run from the ml-platform/ directory (so the djir_ml package and the
# trained models/ folder are in the build context):
#
#   docker build -f serving/Dockerfile -t djir-pricing .
#   docker run -p 8000:8000 djir-pricing
#
# Then: curl localhost:8000/health   |   open http://localhost:8000/docs
FROM python:3.12-slim

WORKDIR /app

# Install serving dependencies first for better layer caching.
COPY serving/requirements.txt ./serving/requirements.txt
RUN pip install --no-cache-dir -r serving/requirements.txt

# Shared library, serving code and the trained model artifacts.
COPY djir_ml ./djir_ml
COPY serving ./serving
COPY models ./models

ENV DJIR_MODELS_DIR=/app/models
EXPOSE 8000

# Run unprivileged; the image only needs to read its code and models.
RUN useradd --system --uid 10001 djir
USER djir

# Liveness only: /health answers 200 whenever the API can quote, and that
# includes the heuristic fallback when the models failed to load. Whether the
# models are pricing is the `models_loaded` field (plus `load_error`), not the
# status code. Slim images have no curl, hence the Python one-liner.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)"

CMD ["uvicorn", "serving.app:app", "--host", "0.0.0.0", "--port", "8000"]
