"""Build a reproducible, source-only WebExtension archive without credentials or dev tools."""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parents[1]
extension = root / "extension"
version = json.loads((extension / "manifest.json").read_text())["version"]
output = root / "dist"
output.mkdir(exist_ok=True)
target = output / f"anime-trail-{version}.zip"
with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(extension.rglob("*")):
        if path.is_file() and not path.name.startswith("."):
            info = zipfile.ZipInfo(str(path.relative_to(extension)), date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, path.read_bytes())
checksum = hashlib.sha256(target.read_bytes()).hexdigest()
(output / f"{target.name}.sha256").write_text(f"{checksum}  {target.name}\n")
print(f"Built {target} ({target.stat().st_size:,} bytes)\nSHA-256: {checksum}")
