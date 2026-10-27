"""Create a point-in-time archive of the SQLite database and uploaded evidence."""
from __future__ import annotations

import os
import sqlite3
import sys
import tempfile
import zipfile
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("PROOFPATH_DATA_DIR", str(BASE_DIR / "data"))).resolve()


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python backup.py <backup.zip>", file=sys.stderr)
        return 2
    destination = Path(sys.argv[1]).expanduser().resolve()
    if destination == DATA_DIR or DATA_DIR in destination.parents:
        print("Choose a backup destination outside the live data directory.", file=sys.stderr)
        return 2
    database = DATA_DIR / "proofpath.db"
    uploads = DATA_DIR / "uploads"
    if not database.is_file():
        print(f"Database not found: {database}", file=sys.stderr)
        return 1
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as temporary:
        snapshot = Path(temporary) / "proofpath.db"
        with sqlite3.connect(database) as source, sqlite3.connect(snapshot) as target:
            source.backup(target)
        with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.write(snapshot, "proofpath.db")
            if uploads.is_dir():
                for item in uploads.iterdir():
                    if item.is_file():
                        archive.write(item, f"uploads/{item.name}")
    try:
        destination.chmod(0o600)
    except OSError:
        pass
    print(f"Backup created: {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
