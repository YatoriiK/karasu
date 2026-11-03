import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOME = Path(os.environ["KARASU_HOME"]) if os.environ.get("KARASU_HOME") else ROOT
DATA = Path(os.environ["KARASU_DATA"]) if os.environ.get("KARASU_DATA") else HOME / "data"
CACHE = HOME / "cache"

for _key, _value in {
    "HF_HOME": CACHE / "hf",
    "TORCH_HOME": CACHE / "torch",
    "HF_HUB_DISABLE_SYMLINKS_WARNING": "1",
    "TOKENIZERS_PARALLELISM": "false",
}.items():
    os.environ.setdefault(_key, str(_value))

__version__ = "0.5.11"
