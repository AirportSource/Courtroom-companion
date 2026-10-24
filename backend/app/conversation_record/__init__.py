"""Persistent Conversation Record: a user-facing archive, never LLM context."""

from .store import ConversationRecordError, ConversationRecordStore, record_dir

__all__ = ["ConversationRecordError", "ConversationRecordStore", "record_dir", "install_conversation_record"]


def install_conversation_record(app, store: "ConversationRecordStore | None" = None) -> None:
    """Attach the store and routes to an app (called once from create_app)."""
    from ..api.conversation_record_routes import router

    app.state.conversation_record = store or ConversationRecordStore(record_dir())
    app.include_router(router)
