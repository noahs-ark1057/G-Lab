from __future__ import annotations

import argparse
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen


HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/135.0.0.0 Safari/537.36"
    )
}


def to_local_url(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def file_name_for_url(url: str) -> str:
    parsed = urlparse(url)
    return Path(parsed.path).name


def download(url: str, dest: Path) -> None:
    if dest.exists():
        return

    dest.parent.mkdir(parents=True, exist_ok=True)
    request = Request(url, headers=HEADERS)
    with urlopen(request, timeout=60) as response:
        dest.write_bytes(response.read())


def collect_image_jobs(database: dict, image_root: Path) -> dict[str, Path]:
    jobs: dict[str, Path] = {}
    for card in database["cards"]:
        if card.get("imageUrl"):
            jobs[card["imageUrl"]] = image_root / file_name_for_url(card["imageUrl"])
        for variant in card.get("variants", []):
            if variant.get("imageUrl"):
                jobs[variant["imageUrl"]] = image_root / file_name_for_url(variant["imageUrl"])
    return jobs


def patch_database(database: dict, image_root: Path, workspace_root: Path) -> dict:
    for card in database["cards"]:
        if card.get("imageUrl"):
            local_path = image_root / file_name_for_url(card["imageUrl"])
            card["imageUrlLocal"] = to_local_url(local_path, workspace_root)
        for variant in card.get("variants", []):
            if variant.get("imageUrl"):
                local_path = image_root / file_name_for_url(variant["imageUrl"])
                variant["imageUrlLocal"] = to_local_url(local_path, workspace_root)
    return database


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", default="data/official-cards-jp.json")
    parser.add_argument("--js", default="data/official-cards-jp.js")
    parser.add_argument("--image-dir", default="assets/official-cards")
    parser.add_argument("--workers", type=int, default=12)
    args = parser.parse_args()

    workspace_root = Path.cwd()
    json_path = workspace_root / args.json
    js_path = workspace_root / args.js
    image_root = workspace_root / args.image_dir

    database = json.loads(json_path.read_text(encoding="utf-8"))
    jobs = collect_image_jobs(database, image_root)

    with ThreadPoolExecutor(max_workers=args.workers) as executor:
      futures = {executor.submit(download, url, dest): url for url, dest in jobs.items()}
      for future in as_completed(futures):
          future.result()

    patched = patch_database(database, image_root, workspace_root)
    payload = json.dumps(patched, ensure_ascii=False, indent=2)
    json_path.write_text(payload, encoding="utf-8")
    js_path.write_text(f"window.__OFFICIAL_GUNDAM_CARD_DB = {payload};\n", encoding="utf-8")
    print(f"Cached {len(jobs)} official images into {image_root}")


if __name__ == "__main__":
    main()
