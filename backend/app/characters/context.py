"""Deterministic, provider-agnostic bound on the history sent to the model.

Only the in-memory dialogue history is budgeted. Nothing is summarized or rewritten, and the
persistent Conversation Record / Court Record is never added. Cost is a script-aware estimate
(ASCII counts 1, other characters 3: Japanese costs ~1-1.5 tokens per character, English ~0.3)
so the same limits behave sensibly for English, French and Japanese without a tokenizer.
Over the budget, the oldest whole messages are dropped first; the current message is never dropped.
"""

from ..llm.schemas import ChatMessage

#: A single history entry is clipped beyond this cost (user text is <= 2,000 chars at the API).
MAX_HISTORY_MESSAGE_COST = 8000
#: Total estimated cost of history entries (~4k English tokens, ~5-8k Japanese tokens).
MAX_HISTORY_COST = 16000
TRUNCATION_MARKER = " […]"


def text_cost(text: str) -> int:
    return sum(1 if ord(c) < 128 else 3 for c in text)


def _clip(message: ChatMessage) -> ChatMessage:
    if text_cost(message.content) <= MAX_HISTORY_MESSAGE_COST:
        return message
    budget, kept = MAX_HISTORY_MESSAGE_COST - text_cost(TRUNCATION_MARKER), []
    for char in message.content:
        budget -= 1 if ord(char) < 128 else 3
        if budget < 0:
            break
        kept.append(char)
    return message.model_copy(update={"content": "".join(kept) + TRUNCATION_MARKER})


def fit_history(history: list[ChatMessage]) -> list[ChatMessage]:
    """Return the newest suffix of `history` that fits the budget, starting at a user message."""
    clipped = [_clip(message) for message in history]
    total = sum(text_cost(message.content) for message in clipped)
    start = 0
    while start < len(clipped) and (total > MAX_HISTORY_COST or clipped[start].role != "user"):
        total -= text_cost(clipped[start].content)
        start += 1
    return clipped[start:]
