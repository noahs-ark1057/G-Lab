from __future__ import annotations

import argparse
import html
import json
import re
import time
from pathlib import Path
from typing import Any
from urllib.parse import urljoin
from urllib.request import Request, urlopen


BASE_URL = "https://www.gundam-gcg.com"
INDEX_URL = f"{BASE_URL}/jp/tournament-results/"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/135.0.0.0 Safari/537.36"
    )
}

INDEX_EVENT_RE = re.compile(
    r'<a href="\./event\.php\?series=(\d+)&event=(\d+)" class="shopListDetailInner"[^>]*>'
    r'[\s\S]*?<time datetime="([^"]+)">([^<]+)</time>'
    r'[\s\S]*?<h4 class="shopName">([\s\S]*?)</h4>',
    re.S,
)
EVENT_TITLE_RE = re.compile(r'<div class="articleHead">[\s\S]*?<h2>([\s\S]*?)</h2>', re.S)
EVENT_STORE_RE = re.compile(
    r'<dl class="eventInfoList">[\s\S]*?<dt>開催店舗</dt>\s*<dd>([\s\S]*?)</dd>',
    re.S,
)
PLAYER_LINK_RE = re.compile(
    r'<a href="\./players_deck\.php\?series=(\d+)&event=(\d+)&no=(\d+)" class="userListDetailInner"[^>]*>'
    r'[\s\S]*?<span class="userInfoRank">\s*([\s\S]*?)\s*</span>'
    r'[\s\S]*?<h4 class="userInfoName">([\s\S]*?)</h4>',
    re.S,
)
DECK_HEAD_RE = re.compile(r'<div class="articleHead">[\s\S]*?<h2>([\s\S]*?)</h2>', re.S)
DECK_INFO_RE = re.compile(r"<dt>([^<]+)</dt>\s*<dd>([\s\S]*?)</dd>", re.S)
USE_CARD_RE = re.compile(
    r'<a href="/jp/images/cards/card/([^"]+?\.webp)"[^>]*>'
    r'[\s\S]*?<span class="useCardsNum">(\d+)</span>',
    re.S,
)
TCGPLUS_RE = re.compile(r'href="(https://www\.bandai-tcg-plus\.com/deck_recipe[^"]+)"')


def fetch(url: str) -> bytes:
    request = Request(url, headers=HEADERS)
    with urlopen(request, timeout=30) as response:
        return response.read()


def decode(payload: bytes) -> str:
    return payload.decode("utf-8", "ignore")


def strip_html(fragment: str) -> str:
    text = re.sub(r"<br\s*/?>", "\n", fragment)
    text = re.sub(r"</p>\s*<p>", "\n\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    text = text.replace("\u3000", " ")
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    return text.strip()


def normalize_card_number(image_name: str) -> str:
    return Path(image_name).stem.upper()


def parse_index_events(index_html: str, event_limit: int) -> list[dict[str, str]]:
    events: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for series_id, event_id, iso_date, display_date, store_name in INDEX_EVENT_RE.findall(index_html):
        key = (series_id, event_id)
        if key in seen:
            continue
        seen.add(key)
        events.append(
            {
                "seriesId": series_id,
                "eventId": event_id,
                "eventDate": strip_html(display_date) or iso_date,
                "storeName": strip_html(store_name),
                "sourceUrl": urljoin(INDEX_URL, f"./event.php?series={series_id}&event={event_id}"),
            }
        )
        if len(events) >= event_limit:
            break
    return events


def parse_event_page(event_html: str, placement_limit: int) -> dict[str, Any]:
    title_match = EVENT_TITLE_RE.search(event_html)
    store_match = EVENT_STORE_RE.search(event_html)
    players = []
    for series_id, event_id, no, rank, player_name in PLAYER_LINK_RE.findall(event_html):
        players.append(
            {
                "seriesId": series_id,
                "eventId": event_id,
                "placementNo": no,
                "rank": strip_html(rank),
                "playerName": strip_html(player_name),
                "sourceUrl": urljoin(
                    INDEX_URL,
                    f"./players_deck.php?series={series_id}&event={event_id}&no={no}",
                ),
            }
        )
        if len(players) >= placement_limit:
            break

    return {
        "eventName": strip_html(title_match.group(1)) if title_match else "",
        "storeName": strip_html(store_match.group(1)) if store_match else "",
        "players": players,
    }


def parse_deck_page(deck_html: str, source_url: str) -> dict[str, Any]:
    head_match = DECK_HEAD_RE.search(deck_html)
    info = {strip_html(key): strip_html(value) for key, value in DECK_INFO_RE.findall(deck_html)}
    main_cards = [
        [normalize_card_number(image_name), int(qty)]
        for image_name, qty in USE_CARD_RE.findall(deck_html)
    ]
    tcg_match = TCGPLUS_RE.search(deck_html)

    return {
        "deckName": strip_html(head_match.group(1)) if head_match else "大会入賞デッキ",
        "eventName": info.get("大会名", ""),
        "storeName": info.get("開催店舗", ""),
        "eventDate": info.get("開催日", ""),
        "main": main_cards,
        "token": [],
        "tokenNote": "公式大会結果ページにトークン一覧はありません。",
        "sourceUrl": source_url,
        "tcgPlusUrl": html.unescape(tcg_match.group(1)) if tcg_match else "",
    }


def build_reference_database(event_limit: int, placement_limit: int, delay: float) -> dict[str, Any]:
    index_html = decode(fetch(INDEX_URL))
    events = parse_index_events(index_html, event_limit=event_limit)
    decks: list[dict[str, Any]] = []
    fetched_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    for event_meta in events:
        event_html = decode(fetch(event_meta["sourceUrl"]))
        event_detail = parse_event_page(event_html, placement_limit=placement_limit)
        event_name = event_detail["eventName"] or event_meta["eventId"]
        store_name = event_detail["storeName"] or event_meta["storeName"]

        for player_meta in event_detail["players"]:
            deck_html = decode(fetch(player_meta["sourceUrl"]))
            deck_data = parse_deck_page(deck_html, player_meta["sourceUrl"])
            decks.append(
                {
                    "id": f"{player_meta['eventId']}-{player_meta['placementNo']}",
                    "deckName": deck_data["deckName"],
                    "rank": player_meta["rank"],
                    "playerName": player_meta["playerName"],
                    "eventName": deck_data["eventName"] or event_name,
                    "storeName": deck_data["storeName"] or store_name,
                    "eventDate": deck_data["eventDate"] or event_meta["eventDate"],
                    "sourceUrl": deck_data["sourceUrl"],
                    "tcgPlusUrl": deck_data["tcgPlusUrl"],
                    "fetchedAt": fetched_at,
                    "main": deck_data["main"],
                    "token": deck_data["token"],
                    "tokenNote": deck_data["tokenNote"],
                }
            )
            if delay:
                time.sleep(delay)

        if delay:
            time.sleep(delay)

    return {
        "generatedAt": fetched_at,
        "source": INDEX_URL,
        "eventCount": len(events),
        "deckCount": len(decks),
        "decks": decks,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", default="data/tournament-reference-decks-jp.json")
    parser.add_argument("--js", default="data/tournament-reference-decks-jp.js")
    parser.add_argument("--event-limit", type=int, default=4)
    parser.add_argument("--placement-limit", type=int, default=3)
    parser.add_argument("--delay", type=float, default=0.0)
    args = parser.parse_args()

    database = build_reference_database(
        event_limit=args.event_limit,
        placement_limit=args.placement_limit,
        delay=args.delay,
    )
    payload = json.dumps(database, ensure_ascii=False, indent=2)

    json_path = Path(args.json)
    js_path = Path(args.js)
    json_path.parent.mkdir(parents=True, exist_ok=True)
    js_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(payload, encoding="utf-8")
    js_path.write_text(
        "window.__TOURNAMENT_REFERENCE_DECKS = " + payload + ";\n",
        encoding="utf-8",
    )
    print(f"Wrote {database['deckCount']} tournament reference decks to {json_path} and {js_path}")


if __name__ == "__main__":
    main()
