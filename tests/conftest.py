import copy
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from karasu import config  # noqa: E402
from karasu.db import DB  # noqa: E402


class FakeCtx:
    def __init__(self, tmp_path):
        self.db = DB(tmp_path / "test.db")
        self.cfg = copy.deepcopy(config.DEFAULTS)
        self.logs = []

    def log(self, message):
        self.logs.append(message)


@pytest.fixture
def ctx(tmp_path):
    c = FakeCtx(tmp_path)
    yield c
    c.db.close()
