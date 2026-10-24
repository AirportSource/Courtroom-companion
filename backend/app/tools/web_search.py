"""Web search tool (D-067): Brave Search or Tavily, key kept in the OS vault, top-5 snippets only."""

import json
import threading
from pathlib import Path

import httpx

PROVIDERS = {"brave": "Brave Search", "tavily": "Tavily"}
MAX_RESULTS = 5
QUERY_MAX = 300
SNIPPET_MAX = 400


class WebSearchError(ValueError):
    pass


def credential_ref(provider: str) -> str:
    return f"courtroom-web-search:{provider}"


class WebSearchConfig:
    """`<config>/tools.json` → {"webSearch": {"provider": "brave" | "tavily"}} (no secrets)."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.Lock()

    def _load(self) -> dict:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        return data if isinstance(data, dict) else {}

    @property
    def provider(self) -> str | None:
        provider = self._load().get("webSearch", {}).get("provider")
        return provider if provider in PROVIDERS else None

    def set_provider(self, provider: str | None) -> None:
        if provider is not None and provider not in PROVIDERS:
            raise WebSearchError("Unknown web search provider.")
        with self._lock:
            data = self._load()
            data["webSearch"] = {"provider": provider} if provider else {}
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(json.dumps(data, indent=1), encoding="utf-8")


def _clip(text: object, limit: int) -> str:
    return " ".join(str(text or "").split())[:limit]


async def search(provider: str, api_key: str, query: str, transport: httpx.AsyncBaseTransport | None = None) -> list[dict]:
    query = _clip(query, QUERY_MAX)
    if not query:
        raise WebSearchError("Empty search query.")
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(15), transport=transport) as client:
            if provider == "brave":
                response = await client.get("https://api.search.brave.com/res/v1/web/search",
                                            params={"q": query, "count": MAX_RESULTS},
                                            headers={"X-Subscription-Token": api_key, "Accept": "application/json"})
            elif provider == "tavily":
                response = await client.post("https://api.tavily.com/search",
                                             json={"query": query, "max_results": MAX_RESULTS},
                                             headers={"Authorization": f"Bearer {api_key}"})
            else:
                raise WebSearchError("Unknown web search provider.")
    except httpx.TimeoutException:
        raise WebSearchError("The web search timed out.") from None
    except httpx.RequestError:
        raise WebSearchError("The web search service is unreachable.") from None
    if response.status_code in (401, 403):
        raise WebSearchError("The web search key was rejected.")
    if response.status_code == 429:
        raise WebSearchError("The web search rate limit was reached.")
    if not response.is_success:
        raise WebSearchError(f"The web search failed (HTTP {response.status_code}).")
    try:
        body = response.json()
    except ValueError:
        raise WebSearchError("The web search returned malformed data.") from None
    items = (body.get("web", {}) or {}).get("results", []) if provider == "brave" else body.get("results", [])
    results = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        url = _clip(item.get("url"), 500)
        if not url.startswith(("http://", "https://")):
            continue
        snippet = item.get("description") if provider == "brave" else item.get("content")
        results.append({"title": _clip(item.get("title"), 200), "url": url, "snippet": _clip(snippet, SNIPPET_MAX)})
        if len(results) == MAX_RESULTS:
            break
    return results


def format_results(query: str, results: list[dict]) -> str:
    if not results:
        return f'Web search for "{query}": no results.'
    lines = [f'Web search for "{query}" (top {len(results)}; snippets only, pages were not opened):']
    for i, r in enumerate(results, 1):
        lines.append(f"{i}. {r['title']} — {r['url']}\n   {r['snippet']}")
    return "\n".join(lines)
