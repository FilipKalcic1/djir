import os
import sys

# Make `djir_ml`, `serving` and `scripts` importable from ml-platform/.
ML_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ML_ROOT)
