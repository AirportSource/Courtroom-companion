"""Canonical lore (D-099): optional lore.md / speech_examples.md, prompt placement, isolation."""

import asyncio
import logging

import pytest

from app.characters import prompt as prompt_module
from app.characters.prompt import (
    CHARACTER_CONTEXT_WARN_COST,
    IDENTITY_RULES,
    LORE_RULES,
    build_system_prompt,
    context_size,
    warn_if_context_large,
)
from app.characters.repository import LORE_WARN_CHARS, CharacterRepository

from .test_character_platform import make_pack, make_service, register

LORE = "Narrative reference point: after the lighthouse fire.\n\n## Family\n- Twin brother: Corvin."


def test_pack_without_lore_loads_and_prompt_has_no_lore_section(tmp_path):
    make_pack(tmp_path, "plain", readiness="ready")
    profile = register(tmp_path, "plain").get("plain")
    assert profile.lore == "" and profile.speech_examples == "" and profile.warnings == []
    prompt = build_system_prompt(profile)
    assert IDENTITY_RULES in prompt  # every character owns its memories, lore or not
    assert "## Canonical memories" not in prompt and LORE_RULES not in prompt
    assert "## Speech style examples" not in prompt


def test_lore_and_speech_examples_are_placed_after_personality_and_before_language(tmp_path):
    folder = make_pack(tmp_path, "keeper", readiness="ready", personality="Calm and precise.")
    (folder / "lore.md").write_text(LORE, encoding="utf-8")
    (folder / "speech_examples.md").write_text("- \"Mind the stairs.\"", encoding="utf-8")
    profile = register(tmp_path, "keeper").get("keeper")
    assert profile.readiness == "ready" and profile.warnings == []
    prompt = build_system_prompt(profile)
    order = [prompt.index(s) for s in (IDENTITY_RULES, "Calm and precise.", "## Canonical memories", LORE,
                                       "## Speech style examples", "Mind the stairs", "## Language", "## Reply format")]
    assert order == sorted(order)


def test_lore_never_changes_readiness(tmp_path, monkeypatch):
    monkeypatch.delenv("COURTROOM_ALLOW_PARTIAL_CHARACTERS", raising=False)
    folder = make_pack(tmp_path, "loreonly", personality=None, performance=None)
    (folder / "lore.md").write_text(LORE, encoding="utf-8")
    assert register(tmp_path, "loreonly").get("loreonly").readiness == "asset-only"


def test_unreadable_lore_is_a_warning_not_a_crash(tmp_path):
    folder = make_pack(tmp_path, "broken", readiness="ready")
    (folder / "lore.md").write_bytes(b"\xff\xfe\xfa not utf-8")
    profile = register(tmp_path, "broken").get("broken")
    assert profile.lore == ""
    assert any("lore.md could not be read" in w for w in profile.warnings)


def test_oversized_lore_is_kept_whole_with_a_warning(tmp_path):
    folder = make_pack(tmp_path, "big", readiness="ready")
    text = "Core: my twin is Corvin.\n" + "x" * LORE_WARN_CHARS
    (folder / "lore.md").write_text(text, encoding="utf-8")
    profile = register(tmp_path, "big").get("big")
    assert profile.lore == text.strip()  # never truncated: identity facts must survive
    assert any("lore.md is" in w for w in profile.warnings)


def test_invalidate_reloads_changed_lore(tmp_path):
    folder = make_pack(tmp_path, "keeper", readiness="ready")
    repo = register(tmp_path, "keeper")
    assert repo.get("keeper").lore == ""
    (folder / "lore.md").write_text(LORE, encoding="utf-8")
    assert repo.get("keeper").lore == ""  # cached
    repo.invalidate("keeper")
    assert repo.get("keeper").lore == LORE


# ---- the real Iris pack ------------------------------------------------------------------------


@pytest.fixture(scope="module")
def iris():
    return CharacterRepository().get("iris")


def test_iris_lore_covers_required_canon_and_narrative_point(iris):
    assert iris.warnings == []
    assert "Narrative reference point" in iris.lore and "Bridge to the Turnabout" in iris.lore
    for required in ("Dahlia Hawthorne", "Phoenix Wright", "Hazakura Temple", "Sister Bikini", "Morgan Fey",
                     "Misty", "Maya Fey", "Miles Edgeworth", "eight months", "Godot", "accomplice"):
        assert required in iris.lore, required
    # Provenance is recorded and uncertainty is explicit.
    assert "aceattorney.fandom.com/wiki/Iris" in iris.lore and "CC BY-SA" in iris.lore
    assert "## Uncertain or not covered" in iris.lore


def test_iris_personality_no_longer_tells_the_model_to_deny_her_own_life(iris):
    text = " ".join(iris.personality.split())
    assert "never something she is unsure of" in text
    assert "never as if hearing the names" in text


def test_iris_lore_reaches_the_provider_and_never_leaks_to_maya():
    service, provider = make_service(CharacterRepository())
    for character in ("iris", "maya_fey", "iris"):
        asyncio.run(service.chat(character, "Est-ce que tu détestes ta sœur pour ce qu'elle a fait ?", session_id="s"))
    iris_first, maya, iris_again = (r.system_prompt for r in provider.requests)
    for prompt in (iris_first, iris_again):
        assert prompt.startswith("You are Iris,")
        assert "## Canonical memories" in prompt and "Dahlia Hawthorne" in prompt and "Phoenix Wright" in prompt
    assert maya.startswith("You are Maya Fey,")
    assert "Dahlia Hawthorne" not in maya and "Hazakura" not in maya and "Sister Bikini" not in maya
    # History is per character: Maya's request carries only its own turn.
    assert [m.content for m in provider.requests[1].messages] == ["Est-ce que tu détestes ta sœur pour ce qu'elle a fait ?"]
    assert iris_first == iris_again


def test_iris_context_size_is_measured_and_bounded(iris):
    prompt = build_system_prompt(iris, "fr")
    # A concise lore, not a whole wiki page: keeps the full system prompt well under ~6k tokens.
    assert len(iris.lore) < LORE_WARN_CHARS
    assert len(prompt) < 24000


def test_memory_rules_separate_confirmed_uncertain_and_unknown():
    rules = " ".join(LORE_RULES.split())
    assert "Confirmed facts are your lived memories" in rules
    assert "remain uncertain for you" in rules and "do not settle them" in rules
    assert "Never invent fictional memories" in rules
    assert "Never invent fictional memories to satisfy the roleplay" in " ".join(IDENTITY_RULES.split())


def test_context_size_is_reported_and_warned_once_without_truncation(tmp_path, caplog, monkeypatch):
    monkeypatch.setattr(prompt_module, "_warned_context", set())
    folder = make_pack(tmp_path, "huge", readiness="ready")
    lore = "Core: my twin is Corvin.\n" + "y" * CHARACTER_CONTEXT_WARN_COST
    (folder / "lore.md").write_text(lore, encoding="utf-8")
    profile = register(tmp_path, "huge").get("huge")
    prompt = build_system_prompt(profile)
    assert "Core: my twin is Corvin." in prompt and lore.strip() in prompt
    size = context_size(profile, prompt)
    assert size["overBudget"] and size["loreCost"] > CHARACTER_CONTEXT_WARN_COST
    with caplog.at_level(logging.WARNING, logger="app.characters.prompt"):
        assert warn_if_context_large(profile, prompt) and warn_if_context_large(profile, prompt)
    assert sum("exceeds budget" in r.message for r in caplog.records) == 1


def test_every_real_pack_fits_the_context_budget():
    repo = CharacterRepository()
    for character_id in repo.all_ids():
        profile = repo.get(character_id)
        for language in ("en", "fr", "ja"):
            assert not context_size(profile, build_system_prompt(profile, language))["overBudget"], character_id
