"""Subscription providers (D-072): Claude Code and Codex CLIs, with a simulated process runner."""

import asyncio
import json
import os
import sys
from pathlib import Path

import pytest

from app.configuration.profiles import ProfileDraft
from app.llm.attachments import AttachmentUnsupported
from app.llm.base import GenerationRequest, GenerationSettings
from app.llm.config import ProviderConfig
from app.llm.gateway import LLMGateway
from app.llm.providers.subscription_cli import (
    ClaudeCodeProvider, CodexProvider, SubscriptionCliError, _clean_env, run_cli, strict_schema, transcript,
)
from app.llm.schemas import Attachment, ChatMessage

SCHEMA = {"type": "object", "additionalProperties": False, "required": ["beats"], "properties": {
    "beats": {"type": "array", "minItems": 1, "maxItems": 3, "items": {
        "type": "object", "additionalProperties": False, "required": ["text", "emotion"],
        "properties": {"text": {"type": "string", "maxLength": 600}, "emotion": {"type": "string"},
                       "intensity": {"type": "number", "minimum": 0, "maximum": 1},
                       "reaction": {"anyOf": [{"type": "string"}, {"type": "null"}]}}}},
    "settleEmotion": {"anyOf": [{"type": "string"}, {"type": "null"}]}}}
REPLY = {"beats": [{"text": "Hello there!", "emotion": "happy"}]}


def request(*messages: ChatMessage) -> GenerationRequest:
    messages = messages or (ChatMessage(role="user", content="hi"),)
    return GenerationRequest("You are Maya.", list(messages), SCHEMA, GenerationSettings(timeout_s=30))


class Runner:
    def __init__(self, code=0, out="", err="", write=None):
        self.code, self.out, self.err, self.write = code, out, err, write
        self.calls = []

    async def __call__(self, args, stdin, timeout_s, cwd):
        self.calls.append({"args": args, "stdin": stdin, "timeout": timeout_s, "cwd": cwd})
        if self.write:
            Path(args[args.index("-o") + 1]).write_text(self.write, encoding="utf-8")
        return self.code, self.out, self.err


def stream(*events):
    """Claude Code stream-json output: one JSON event per line, the result last."""
    return "\n".join(json.dumps(event) for event in [{"type": "system", "subtype": "init"}, *events]) + "\n"


def sent_content(runner):
    line = json.loads(runner.calls[0]["stdin"])
    assert line["type"] == "user" and line["message"]["role"] == "user"
    return line["message"]["content"]


def test_claude_code_runs_headless_with_schema_and_reads_structured_output():
    runner = Runner(out=stream({"type": "result", "subtype": "success", "is_error": False,
                                "result": json.dumps(REPLY), "structured_output": REPLY}))
    provider = ClaudeCodeProvider(model="haiku", command=["claude.exe"], runner=runner)
    history = (ChatMessage(role="user", content="Bonjour"), ChatMessage(role="assistant", content=json.dumps(REPLY)),
               ChatMessage(role="user", content="Ça va ?"))
    raw = asyncio.run(provider.generate(request(*history)))
    assert raw.content == REPLY
    args = runner.calls[0]["args"]
    assert args[:2] == ["claude.exe", "-p"]
    assert args[args.index("--input-format") + 1] == "stream-json" and args[args.index("--output-format") + 1] == "stream-json"
    for flag in ("--json-schema", "--system-prompt", "--tools", "--setting-sources", "--no-session-persistence"):
        assert flag in args
    assert args[args.index("--tools") + 1] == "" and args[args.index("--setting-sources") + 1] == ""
    assert json.loads(args[args.index("--json-schema") + 1]) == SCHEMA
    assert args[args.index("--model") + 1] == "haiku"
    text = sent_content(runner)  # text-only turn: plain string content
    assert "Bonjour" in text and text.index("Bonjour") < text.index("Ça va ?") and "JSON object only" in text


def test_claude_code_sends_image_and_pdf_evidence_as_content_blocks():
    # D-076: the subscription mode reads presented images and PDFs too.
    runner = Runner(out=stream({"type": "result", "is_error": False, "structured_output": REPLY}))
    image = Attachment(kind="image", name="police.jpg", media_type="image/jpeg", data="AAAA")
    pdf = Attachment(kind="pdf", name="case.pdf", media_type="application/pdf", data="JVBE")
    asyncio.run(ClaudeCodeProvider(command=["claude.exe"], runner=runner).generate(
        request(ChatMessage(role="user", content="Look at these", attachments=[image, pdf]))))
    blocks = sent_content(runner)
    assert blocks[0] == {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": "AAAA"}}
    assert blocks[1]["type"] == "document" and blocks[1]["source"]["data"] == "JVBE" and blocks[1]["title"] == "case.pdf"
    assert blocks[2]["type"] == "text" and "Look at these" in blocks[2]["text"]


@pytest.mark.parametrize("body,code", [
    ({"type": "result", "is_error": True, "result": "Invalid API key · Please run /login", "api_error_status": 401}, "auth_not_configured"),
    ({"type": "result", "is_error": True, "result": "Claude usage limit reached", "api_error_status": 429}, "rate_limited"),
    ({"type": "result", "is_error": True, "result": "Something broke", "api_error_status": 500}, "provider_error"),
])
def test_claude_code_error_mapping(body, code):
    provider = ClaudeCodeProvider(command=["claude.exe"], runner=Runner(code=1, out=stream(body)))
    with pytest.raises(SubscriptionCliError) as error:
        asyncio.run(provider.generate(request()))
    assert error.value.code == code


def test_not_installed_and_no_result():
    with pytest.raises(SubscriptionCliError) as error:
        asyncio.run(ClaudeCodeProvider(command=["definitely-not-installed-cli-xyz"]).generate(request()))
    assert error.value.code == "cli_not_installed"
    with pytest.raises(SubscriptionCliError) as error:
        asyncio.run(ClaudeCodeProvider(command=["claude.exe"], runner=Runner(out="not json", err="login required")).generate(request()))
    assert error.value.code == "auth_not_configured"


def test_codex_exec_uses_strict_schema_file_and_reads_last_message():
    seen = {}

    async def runner(args, stdin, timeout_s, cwd):
        seen["args"], seen["stdin"] = args, stdin
        seen["schema"] = json.loads(Path(args[args.index("--output-schema") + 1]).read_text(encoding="utf-8"))
        Path(args[args.index("-o") + 1]).write_text(json.dumps(REPLY), encoding="utf-8")
        return 0, "", ""

    raw = asyncio.run(CodexProvider(model="gpt-5", command=["codex"], runner=runner).generate(request()))
    assert json.loads(raw.content) == REPLY
    args = seen["args"]
    assert args[:3] == ["codex", "exec", "-"] and args[args.index("--sandbox") + 1] == "read-only"
    for flag in ("--skip-git-repo-check", "--ephemeral", "--ignore-user-config"):
        assert flag in args
    assert args[args.index("-m") + 1] == "gpt-5"
    assert seen["stdin"].startswith("You are Maya.")
    beat = seen["schema"]["properties"]["beats"]["items"]
    assert sorted(beat["required"]) == ["emotion", "intensity", "reaction", "text"]
    assert {"type": "null"} in beat["properties"]["intensity"]["anyOf"]
    assert "maxLength" not in json.dumps(seen["schema"]) and "minItems" not in json.dumps(seen["schema"])
    pdf = Attachment(kind="pdf", name="case.pdf", media_type="application/pdf", data="JVBE")
    with pytest.raises(AttachmentUnsupported):  # Codex takes images, not PDFs
        asyncio.run(CodexProvider(command=["codex"], runner=runner).generate(
            request(ChatMessage(role="user", content="read", attachments=[pdf]))))
    failed = CodexProvider(command=["codex"], runner=Runner(code=1, err="You've hit your usage limit"))
    with pytest.raises(SubscriptionCliError) as error:
        asyncio.run(failed.generate(request()))
    assert error.value.code == "rate_limited"


def test_run_cli_works_on_a_selector_event_loop(tmp_path):
    # `uvicorn --reload` on Windows uses a selector loop, which cannot run asyncio subprocesses.
    script = "import sys; data = sys.stdin.read(); print(data.upper()); print('warn', file=sys.stderr)"
    loop = asyncio.SelectorEventLoop()
    try:
        code, out, err = loop.run_until_complete(run_cli([sys.executable, "-c", script], "all ok", 30, tmp_path))
    finally:
        loop.close()
    assert code == 0 and out.strip() == "ALL OK" and err.strip() == "warn"
    with pytest.raises(SubscriptionCliError) as error:
        asyncio.run(run_cli([sys.executable, "-c", "import time; time.sleep(5)"], "", 0.5, tmp_path))
    assert error.value.code == "timeout"


def test_codex_passes_images_as_files():
    seen = {}

    async def runner(args, stdin, timeout_s, cwd):
        path = Path(args[args.index("--image") + 1])
        seen["suffix"], seen["bytes"] = path.suffix, path.read_bytes()
        Path(args[args.index("-o") + 1]).write_text(json.dumps(REPLY), encoding="utf-8")
        return 0, "", ""

    image = Attachment(kind="image", name="police.jpg", media_type="image/jpeg", data="/9j/4A==")
    asyncio.run(CodexProvider(command=["codex"], runner=runner).generate(
        request(ChatMessage(role="user", content="look", attachments=[image]))))
    assert seen == {"suffix": ".jpg", "bytes": bytes([0xff, 0xd8, 0xff, 0xe0])}


def test_environment_never_carries_api_keys(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-should-not-pass")
    monkeypatch.setenv("CODEX_API_KEY", "x")
    env = _clean_env()
    assert "ANTHROPIC_API_KEY" not in env and "CODEX_API_KEY" not in env
    assert env["COURTROOM_HOOK_DISABLED"] == "1" and env.get("PATH") == os.environ.get("PATH")


def test_strict_schema_and_transcript_helpers():
    strict = strict_schema(SCHEMA)
    assert strict["required"] == ["beats", "settleEmotion"] and strict["additionalProperties"] is False
    assert SCHEMA["properties"]["beats"]["items"]["required"] == ["text", "emotion"]  # input untouched
    assert transcript([ChatMessage(role="user", content="only")]).startswith("User's new message:\nonly")


def test_profiles_and_gateway_accept_subscription_types():
    draft = ProfileDraft(name="Claude Max", provider_type="claude_code", model="sonnet")
    assert draft.base_url is None
    ProfileDraft(name="ChatGPT", provider_type="codex")  # model optional
    with pytest.raises(ValueError):
        ProfileDraft(name="Bad", provider_type="claude_code", base_url="https://example.test")
    assert isinstance(LLMGateway(ProviderConfig(type="claude_code")).provider, ClaudeCodeProvider)
    assert isinstance(LLMGateway(ProviderConfig(type="codex", model="gpt-5")).provider, CodexProvider)
