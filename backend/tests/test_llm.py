import asyncio
import json

import pytest

from app.characters.prompt import build_system_prompt, reply_schema
from app.llm.base import GenerationRequest, GenerationSettings, LLMProvider, RawCompletion
from app.llm.config import ProviderConfig, load_provider_config
from app.llm.gateway import DEFAULT_REGISTRY, LLMGateway, UnknownProviderError
from app.llm.providers.fake import PATTERNS, FakeProvider, choose_pattern
from app.llm.repair import parse_reply
from app.llm.schemas import ChatMessage, CharacterReply


def request(message: str) -> GenerationRequest:
    return GenerationRequest("system", [ChatMessage(role="user", content=message)], {}, GenerationSettings())


def generate(provider: LLMProvider, message: str) -> RawCompletion:
    return asyncio.run(provider.generate(request(message)))


# ---- FakeProvider ----------------------------------------------------------------------------


def test_fake_provider_is_deterministic():
    p = FakeProvider()
    assert generate(p, "Tell me something").content == generate(p, "Tell me something").content


@pytest.mark.parametrize("pattern", sorted(PATTERNS))
def test_fake_patterns_are_valid_replies(pattern):
    result = parse_reply(json.dumps(PATTERNS[pattern]))
    assert isinstance(result.reply, CharacterReply)


def test_fake_provider_multiple_patterns():
    chosen = {choose_pattern(m) for m in ["hello there", "explain python decorators", "thanks!", "guess what", "tell a joke"]}
    assert chosen == {"greeting", "explain", "thanks", "realization", "joke"}
    assert choose_pattern("they said") != "greeting"  # no substring false positive


def test_fake_provider_error_trigger():
    with pytest.raises(Exception):
        generate(FakeProvider(), "#error please")


# ---- repair ----------------------------------------------------------------------------------


def test_repair_handles_fences_prose_and_plain_text():
    fenced = parse_reply('```json\n{"beats": [{"text": "Hi", "emotion": "Happy"}]}\n```')
    assert fenced.reply.beats[0].emotion == "happy"
    prose = parse_reply('Sure! {"beats": [{"text": "Hi"}]} hope that helps')
    assert prose.reply.beats[0].text == "Hi"
    plain = parse_reply("Just talking normally.")
    assert plain.reply.beats[0].text == "Just talking normally."


def test_repair_coerces_bad_fields():
    r = parse_reply({"beats": [{"text": "A", "intensity": "high"}, {"text": "B", "intensity": 7}, {"text": "C", "intensity": "nope"}, {"text": " "}, 42]})
    assert [b.intensity for b in r.reply.beats] == [0.85, 0.7, 0.5]
    assert any("empty text" in w for w in r.warnings)


def test_repair_rejects_unusable_and_paths_in_ids():
    assert parse_reply(None).reply is None
    assert parse_reply({"beats": []}).reply is None
    assert parse_reply("[1, 2, 3]").reply is None
    r = parse_reply({"beats": [{"text": "x", "emotion": "../../etc/passwd", "gesture": "<script>"}]})
    assert r.reply.beats[0].emotion == "" and r.reply.beats[0].gesture is None


# ---- gateway ---------------------------------------------------------------------------------


def test_gateway_selects_provider_and_validates():
    gw = LLMGateway(ProviderConfig(type="fake"))
    result = asyncio.run(gw.generate_reply("sys", [ChatMessage(role="user", content="hello")], {}))
    assert result.error is None and result.reply.beats


def test_unknown_provider():
    with pytest.raises(UnknownProviderError):
        LLMGateway(ProviderConfig(type="nonexistent"))


def test_provider_exception_is_isolated():
    gw = LLMGateway(ProviderConfig(type="fake"))
    result = asyncio.run(gw.generate_reply("sys", [ChatMessage(role="user", content="#error")], {}))
    assert result.reply is None and result.error == "provider_error"


def test_provider_timeout():
    config = ProviderConfig(type="fake", settings=GenerationSettings(timeout_s=0.05))
    gw = LLMGateway(config, registry={"fake": lambda c: FakeProvider(timeout_delay_s=5)})
    result = asyncio.run(gw.generate_reply("sys", [ChatMessage(role="user", content="#timeout")], {}))
    assert result.error == "timeout"


def test_malformed_and_empty_replies():
    gw = LLMGateway(ProviderConfig(type="fake"))
    empty = asyncio.run(gw.generate_reply("sys", [ChatMessage(role="user", content="#empty")], {}))
    assert empty.reply is None and empty.error == "invalid_reply"
    text = asyncio.run(gw.generate_reply("sys", [ChatMessage(role="user", content="#text")], {}))
    assert text.reply.beats[0].text.startswith("Sorry")


def test_custom_provider_can_be_registered():
    class Echo(LLMProvider):
        type = "echo"

        async def generate(self, request):
            return RawCompletion({"beats": [{"text": request.messages[-1].content, "emotion": "neutral"}]})

    gw = LLMGateway(ProviderConfig(type="echo"), registry={**DEFAULT_REGISTRY, "echo": lambda c: Echo()})
    result = asyncio.run(gw.generate_reply("sys", [ChatMessage(role="user", content="ping")], {}))
    assert result.reply.beats[0].text == "ping"


# ---- config / secrets ------------------------------------------------------------------------


def test_config_from_env_and_secret_handling():
    env = {"COURTROOM_LLM_PROVIDER": "fake", "COURTROOM_LLM_MODEL": "m", "COURTROOM_LLM_API_KEY_ENV": "MY_KEY", "MY_KEY": "sk-secret"}
    config = load_provider_config(env)
    assert config.resolve_api_key(env).get_secret_value() == "sk-secret"
    assert "sk-secret" not in json.dumps(config.public_info())
    assert "sk-secret" not in repr(config.resolve_api_key(env))


def test_gateway_info_has_no_secrets():
    info = LLMGateway(ProviderConfig(type="fake", api_key_env="SOME_KEY")).info()
    assert set(info) == {"type", "model", "capabilities"}


# ---- prompt ----------------------------------------------------------------------------------


def test_prompt_and_schema_come_from_character_data(maya, mock_character):
    schema = reply_schema(maya)
    item = schema["properties"]["beats"]["items"]["properties"]
    assert set(item["emotion"]["enum"]) == set(maya.emotions)
    assert schema["properties"]["beats"]["maxItems"] == maya.director.max_beats_per_reply
    prompt = build_system_prompt(maya)
    assert "Maya Fey" in prompt and "clasped_hands" in prompt
    mock_prompt = build_system_prompt(mock_character)
    assert "Robot" in mock_prompt and "Maya" not in mock_prompt and "wave" in mock_prompt
