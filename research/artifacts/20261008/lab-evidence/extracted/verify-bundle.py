"""Verify extracted SplicR export bytes against manifest.json (Python 3)."""
import hashlib
import json
import sys
from pathlib import Path, PurePosixPath

root = Path(__file__).resolve().parent
manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
inventory = manifest.get("files")
if not isinstance(inventory, list) or not inventory:
    sys.exit("No file inventory in manifest.json")
seen = set()
errors = []
for entry in inventory:
    name = entry.get("path", "")
    relative = PurePosixPath(name)
    if not name or relative.is_absolute() or ".." in relative.parts or "\\" in name or name in seen or name == "manifest.json":
        errors.append("Invalid or duplicate inventory path: " + repr(name))
        continue
    seen.add(name)
    path = root.joinpath(*relative.parts)
    if not path.resolve().is_relative_to(root) or not path.is_file() or path.is_symlink():
        errors.append("Missing or unsafe file: " + name)
        continue
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            size += len(chunk)
            digest.update(chunk)
    if size != entry.get("byte_length") or digest.hexdigest() != entry.get("sha256"):
        errors.append("Changed file: " + name)
if errors:
    sys.exit("\n".join(errors))
print("Verified " + str(len(seen)) + " listed files. Checksums establish byte integrity, not scientific correctness or authorship.")
