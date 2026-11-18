"""Check the local Python environment for AUTO-ONE development."""

from __future__ import annotations

import sys
from importlib.metadata import PackageNotFoundError, version

MINIMUM_PYTHON = (3, 12)
MAXIMUM_PYTHON_EXCLUSIVE = (3, 16)


def main() -> int:
    current = sys.version_info[:2]
    print(f"Python: {sys.version.split()[0]}")

    if current < MINIMUM_PYTHON or current >= MAXIMUM_PYTHON_EXCLUSIVE:
        print("ERROR: AUTO-ONE requires Python >=3.12 and <3.16.")
        return 1

    print("Python version: supported")
    for package in ("fastapi", "uvicorn", "pytest", "ruff"):
        try:
            installed = version(package)
        except PackageNotFoundError:
            print(f"NOT INSTALLED: {package}")
        else:
            print(f"{package}: {installed}")

    print("Environment check completed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
