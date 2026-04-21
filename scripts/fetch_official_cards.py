from __future__ import annotations

import argparse
import html
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urljoin
from urllib.request import Request, urlopen


BASE_URL = "https://www.gundam-gcg.com"
JP_CARDS_URL = f"{BASE_URL}/jp/cards/"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/135.0.0.0 Safari/537.36"
    )
}

PACKAGE_RE = re.compile(
    r'class="js-selectBtn-package[^"]*"\s+data-val="([^"]*)">([^<]+)</a>',
    re.S,
)
CARD_ENTRY_RE = re.compile(
    r'data-src="detail\.php\?detailSearch=([^"]+)" class="cardStr">\s*'
    r'<img[^>]+data-src="([^"]+)" alt="([^"]*)"',
    re.S,
)
DT_DD_RE = re.compile(
    r'<dt class="dataTit">([^<]+)</dt>\s*<dd class="dataTxt(?: isRegular)?">([\s\S]*?)</dd>',
    re.S,
)
FAQ_RE = re.compile(
    r'<div class="qaCol">[\s\S]*?<h3 class="qaColNum">([^<]+)</h3>'
    r'[\s\S]*?<p class="qaColDate"><span>([^<]+)</span>[\s\S]*?</p>'
    r'[\s\S]*?<dt class="qaColQuestion">([\s\S]*?)</dt>'
    r'[\s\S]*?<dd class="qaColAnswer">\s*<p>([\s\S]*?)</p>',
    re.S,
)


def fetch(url: str, *, cache_path: Path | None = None, data: bytes | None = None) -> bytes:
    if cache_path and cache_path.exists():
        return cache_path.read_bytes()

    request = Request(url, data=data, headers=HEADERS)
    with urlopen(request, timeout=30) as response:
        payload = response.read()

    if cache_path:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_bytes(payload)
    return payload


def decode(payload: bytes) -> str:
    return payload.decode("utf-8", "ignore")


def strip_html(fragment: str) -> str:
    text = fragment.replace("<br>", "\n").replace("<br/>", "\n").replace("<br />", "\n")
    text = re.sub(r"</p>\s*<p>", "\n\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    text = text.replace("\u3000", " ")
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    return text.strip()


def split_bracketed(value: str, left: str, right: str) -> list[str]:
    matches = re.findall(re.escape(left) + r"([^" + re.escape(right) + r"]+)" + re.escape(right), value)
    if matches:
        return [match.strip() for match in matches if match.strip()]
    chunks = [chunk.strip() for chunk in re.split(r"[／/,]\s*|\s{2,}|\n", value) if chunk.strip()]
    return chunks


def to_int(value: str) -> int | None:
    value = value.strip()
    if not value or value in {"-", "―"}:
        return None
    value = re.sub(r"[^\d-]", "", value)
    return int(value) if value else None


def normalize_variant_label(detail_id: str) -> str:
    match = re.search(r"_p(\d+)$", detail_id)
    if not match:
        return "通常"
    return f"パラレル {match.group(1)}"


def base_detail_id(detail_id: str) -> str:
    return re.sub(r"_p\d+$", "", detail_id)


def parse_packages(cards_page_html: str) -> list[dict[str, str]]:
    packages: list[dict[str, str]] = []
    seen: set[str] = set()
    for package_id, package_name in PACKAGE_RE.findall(cards_page_html):
        package_id = package_id.strip()
        package_name = strip_html(package_name)
        if not package_id or package_name == "ALL" or package_id in seen:
            continue
        packages.append({"id": package_id, "name": package_name})
        seen.add(package_id)
    return packages


def parse_search_results(search_html: str, package: dict[str, str]) -> dict[str, dict[str, Any]]:
    cards: dict[str, dict[str, Any]] = {}
    for detail_id, image_path, alt_text in CARD_ENTRY_RE.findall(search_html):
        card_id = base_detail_id(detail_id)
        entry = cards.setdefault(
            card_id,
            {
                "id": card_id,
                "detailId": card_id,
                "name": strip_html(alt_text),
                "imageUrl": urljoin(JP_CARDS_URL, image_path),
                "packages": [],
                "variants": [],
            },
        )
        if package not in entry["packages"]:
            entry["packages"].append(package)
        variant = {
            "detailId": detail_id,
            "label": normalize_variant_label(detail_id),
            "imageUrl": urljoin(JP_CARDS_URL, image_path),
        }
        if variant not in entry["variants"]:
            entry["variants"].append(variant)
        if detail_id == card_id:
            entry["imageUrl"] = variant["imageUrl"]
            entry["name"] = strip_html(alt_text) or entry["name"]
    return cards


def parse_detail(detail_html: str, detail_id: str) -> dict[str, Any]:
    fields = {strip_html(key): strip_html(value) for key, value in DT_DD_RE.findall(detail_html)}

    effect_text = strip_html(
        re.search(
            r'<div class="cardDataRow overview">\s*<div class="dataTxt isRegular">([\s\S]*?)</div>',
            detail_html,
            re.S,
        ).group(1)
        if re.search(
            r'<div class="cardDataRow overview">\s*<div class="dataTxt isRegular">([\s\S]*?)</div>',
            detail_html,
            re.S,
        )
        else ""
    )

    name_match = re.search(r'<h1 class="cardName">([\s\S]*?)</h1>', detail_html, re.S)
    image_match = re.search(r'<div class="cardImage">\s*<img src=\s*"([^"]+)"', detail_html, re.S)
    number_match = re.search(r'<div class="cardNo">\s*([^<]+)\s*</div>', detail_html, re.S)
    rarity_match = re.search(r'<div class="rarity">\s*([^<]+)\s*</div>', detail_html, re.S)
    block_match = re.search(r'<div class="blockIcon">([^<]+)</div>', detail_html, re.S)

    faqs = []
    for faq_id, faq_date, question, answer in FAQ_RE.findall(detail_html):
        faqs.append(
            {
                "id": strip_html(faq_id),
                "date": strip_html(faq_date),
                "question": strip_html(question),
                "answer": strip_html(answer),
            }
        )

    traits = split_bracketed(fields.get("特徴", ""), "〔", "〕")
    link_value = fields.get("リンク", "")
    links = []
    for left, right in (("「", "」"), ("〔", "〕"), ("[", "]"), ("(", ")")):
        for item in split_bracketed(link_value, left, right):
            if item and item not in links:
                links.append(item)
    zones = [chunk for chunk in re.split(r"\s+", fields.get("地形", "").strip()) if chunk]

    return {
        "id": base_detail_id(detail_id),
        "detailId": base_detail_id(detail_id),
        "number": strip_html(number_match.group(1)) if number_match else base_detail_id(detail_id),
        "name": strip_html(name_match.group(1)) if name_match else base_detail_id(detail_id),
        "rarity": strip_html(rarity_match.group(1)) if rarity_match else "",
        "block": strip_html(block_match.group(1)) if block_match else "",
        "imageUrl": urljoin(JP_CARDS_URL, image_match.group(1)) if image_match else "",
        "level": to_int(fields.get("Lv.", "")),
        "cost": to_int(fields.get("COST", "")),
        "color": fields.get("色", ""),
        "type": fields.get("タイプ", ""),
        "text": effect_text,
        "zones": zones,
        "traits": traits,
        "links": links,
        "ap": to_int(fields.get("AP", "")),
        "hp": to_int(fields.get("HP", "")),
        "sourceTitle": fields.get("出典タイトル", ""),
        "whereToGet": fields.get("入手情報", ""),
        "faq": faqs,
    }


def merge_cards(source: dict[str, dict[str, Any]], incoming: dict[str, dict[str, Any]]) -> None:
    for card_id, payload in incoming.items():
        if card_id not in source:
            source[card_id] = payload
            continue

        current = source[card_id]
        for package in payload.get("packages", []):
            if package not in current["packages"]:
                current["packages"].append(package)
        for variant in payload.get("variants", []):
            if variant not in current["variants"]:
                current["variants"].append(variant)
        if payload.get("imageUrl") and not current.get("imageUrl"):
            current["imageUrl"] = payload["imageUrl"]


def sort_key(card: dict[str, Any]) -> tuple[Any, ...]:
    first_package = card.get("packages", [{}])[0].get("name", "")
    number = card.get("number", "")
    match = re.match(r"([A-Z-]+)(\d+)?", number)
    prefix = match.group(1) if match else number
    suffix = int(match.group(2)) if match and match.group(2) else 0
    return (first_package, prefix, suffix, number)


def build_database(cache_dir: Path, delay: float = 0.0, workers: int = 8) -> dict[str, Any]:
    cards_page_html = decode(fetch(JP_CARDS_URL, cache_path=cache_dir / "cards-home.html"))
    packages = parse_packages(cards_page_html)

    cards_by_id: dict[str, dict[str, Any]] = {}
    for package in packages:
        post_data = urlencode({"package": package["id"]}).encode("utf-8")
        search_html = decode(
            fetch(
                f"{JP_CARDS_URL}index.php",
                cache_path=cache_dir / "search" / f"{package['id']}.html",
                data=post_data,
            )
        )
        merge_cards(cards_by_id, parse_search_results(search_html, package))
        if delay:
            time.sleep(delay)

    detail_ids = sorted(cards_by_id.keys())

    def _load_detail(detail_id: str) -> tuple[str, dict[str, Any]]:
        detail_html = decode(
            fetch(
                f"{JP_CARDS_URL}detail.php?detailSearch={detail_id}",
                cache_path=cache_dir / "detail" / f"{detail_id}.html",
            )
        )
        return detail_id, parse_detail(detail_html, detail_id)

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(_load_detail, detail_id): detail_id for detail_id in detail_ids}
        for future in as_completed(futures):
            detail_id, detail_payload = future.result()
            card = cards_by_id[detail_id]
            card.update(detail_payload)
            card["variants"] = sorted(
                card["variants"],
                key=lambda variant: (0 if variant["detailId"] == detail_id else 1, variant["detailId"]),
            )
            if delay:
                time.sleep(delay)

    cards = sorted(cards_by_id.values(), key=sort_key)

    return {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": JP_CARDS_URL,
        "packageCount": len(packages),
        "cardCount": len(cards),
        "packages": packages,
        "cards": cards,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="data/official-cards-jp.json")
    parser.add_argument("--js-out", default="data/official-cards-jp.js")
    parser.add_argument("--cache-dir", default="cache/official")
    parser.add_argument("--delay", type=float, default=0.0)
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()

    cache_dir = Path(args.cache_dir)
    out_path = Path(args.out)
    js_out_path = Path(args.js_out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    js_out_path.parent.mkdir(parents=True, exist_ok=True)

    database = build_database(cache_dir=cache_dir, delay=args.delay, workers=args.workers)
    payload = json.dumps(database, ensure_ascii=False, indent=2)
    out_path.write_text(payload, encoding="utf-8")
    js_out_path.write_text(
        "window.__OFFICIAL_GUNDAM_CARD_DB = " + payload + ";\n",
        encoding="utf-8",
    )
    print(
        f"Wrote {database['cardCount']} cards across {database['packageCount']} packages "
        f"to {out_path} and {js_out_path}"
    )


if __name__ == "__main__":
    main()
