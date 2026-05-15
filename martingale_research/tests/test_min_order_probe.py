from __future__ import annotations

import sys
import unittest
from pathlib import Path


def _ensure_paths() -> None:
    root = Path(__file__).resolve().parents[1]
    src = root / "src"
    scripts = root / "scripts"
    for p in (src, scripts):
        if str(p) not in sys.path:
            sys.path.insert(0, str(p))


_ensure_paths()

import run_min_order_probe  # noqa: E402
from py_clob_client_v2.clob_types import OrderType  # noqa: E402


class TestMinOrderProbe(unittest.TestCase):
    def test_order_type_mapping(self) -> None:
        self.assertEqual(getattr(OrderType, "FOK"), "FOK")
        self.assertEqual(getattr(OrderType, "FAK"), "FAK")

    def test_script_module_loads(self) -> None:
        self.assertTrue(callable(run_min_order_probe.main))


if __name__ == "__main__":
    unittest.main()
