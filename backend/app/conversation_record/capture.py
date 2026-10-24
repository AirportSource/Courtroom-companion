"""Server-side capture of one completed, successful semantic turn."""

import logging

log = logging.getLogger(__name__)


def capture_turn(app, character_id: str, user_text: str, result, request_id: str | None) -> None:
    """Archive a finished turn. No-op for failed turns; never raises into the chat flow."""
    store = getattr(app.state, "conversation_record", None)
    if store is None or result.reply is None or result.error:
        return
    segments = result.performance.get("segments", [])
    text = "\n".join(s["text"] for s in segments if s.get("text")) or "\n".join(b.text for b in result.reply.beats)
    try:
        store.add(character_id, user_text, text, [a["id"] for a in result.artifacts], request_id)
    except Exception:
        log.warning("Conversation record entry could not be saved.")
