"""Subscription providers (D-072): use the owner's Claude or ChatGPT/Codex plan through its official CLI.

Instead of an API key, these adapters run the locally installed and logged-in CLI in headless mode:

- `claude_code` → `claude -p` (Claude Code, Pro/Max subscription via `claude login`)
- `codex`       → `codex exec` (Codex CLI, ChatGPT plan via `codex login`)

Each call is one tool-free, read-only, non-persistent turn: the character system prompt, the
conversation as text on stdin, and the reply JSON schema enforced by the CLI. User settings, hooks and
API-key environment variables are kept out, so the subscription (not an API key) is billed and the
Claude Code companion hooks never fire for these generations. Executables are found on PATH (npm
wrappers are resolved to the real binary) or set with COURTROOM_CLAUDE_BIN / COURTROOM_CODEX_BIN.
"""

import asyncio
import copy
import json
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any

from ..attachments import AttachmentUnsupported, has_attachments
from ..base import GenerationRequest, LLMProvider, ProviderCapabilities, ProviderError, RawCompletion, StructuredOutputMode
from ..schemas import ChatMessage

#: Environment variables that would switch a CLI from the subscription to API billing.
API_KEY_VARIABLES = ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CODEX_API_KEY", "OPENAI_API_KEY")
OUTPUT_MAX = 2_000_000


class SubscriptionCliError(ProviderError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _npm_binary(wrapper: Path, package: str, relative: str) -> Path | None:
    """npm puts `<name>.cmd`/`.ps1` wrappers next to node_modules; return the real target if present."""
    candidate = wrapper.parent / "node_modules" / package / relative
    return candidate if candidate.exists() else None


def resolve_cli(name: str, env_var: str, npm: list[tuple[str, str]]) -> list[str] | None:
    """Command prefix for a CLI: explicit override, npm package binary, or PATH executable."""
    override = os.environ.get(env_var)
    if override:
        return [override]
    found = shutil.which(name)
    if not found:
        return None
    path = Path(found)
    if path.suffix.lower() in (".cmd", ".ps1", ".bat", "") and os.name == "nt":
        for package, relative in npm:
            target = _npm_binary(path, package, relative)
            if target is not None:
                return ["node", str(target)] if target.suffix == ".js" else [str(target)]
    return [str(path)]


def transcript(messages: list[ChatMessage]) -> str:
    """The conversation as plain text (previous replies are the character's own JSON)."""
    lines = []
    for message in messages[:-1]:
        speaker = "User" if message.role == "user" else "You (your previous reply)"
        lines.append(f"{speaker}:\n{message.content}")
    history = ("Conversation so far:\n\n" + "\n\n".join(lines) + "\n\n") if lines else ""
    return f"{history}User's new message:\n{messages[-1].content}\n\nReply now with the JSON object only."


def strict_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """OpenAI strict structured outputs: every property required (optional ones become nullable),
    additionalProperties false, no unsupported keywords."""
    schema = copy.deepcopy(schema)

    def visit(node: Any) -> Any:
        if isinstance(node, dict):
            for key in ("minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems", "pattern", "format"):
                node.pop(key, None)
            if node.get("type") == "object" and isinstance(node.get("properties"), dict):
                required = set(node.get("required", []))
                for name, prop in list(node["properties"].items()):
                    prop = visit(prop)
                    if name not in required and not _nullable(prop):
                        prop = {"anyOf": [prop, {"type": "null"}]}
                    node["properties"][name] = prop
                node["required"] = list(node["properties"])
                node["additionalProperties"] = False
            for key in ("items", "anyOf"):
                if key in node:
                    node[key] = visit(node[key])
            return node
        if isinstance(node, list):
            return [visit(item) for item in node]
        return node

    return visit(schema)


def _nullable(node: Any) -> bool:
    return isinstance(node, dict) and (node.get("type") == "null" or any(
        isinstance(option, dict) and option.get("type") == "null" for option in node.get("anyOf", [])))


def _clean_env() -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if k not in API_KEY_VARIABLES}
    env["COURTROOM_HOOK_DISABLED"] = "1"  # our Claude Code hook ignores these runs (D-067)
    return env


async def run_cli(command: list[str], stdin: str, timeout_s: float, cwd: Path) -> tuple[int, str, str]:
    try:
        process = await asyncio.create_subprocess_exec(
            *command, cwd=str(cwd), env=_clean_env(),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
    except (FileNotFoundError, PermissionError, OSError):
        raise SubscriptionCliError("cli_not_installed", f"{command[0]} could not be started") from None
    try:
        out, err = await asyncio.wait_for(process.communicate(stdin.encode("utf-8")), timeout=timeout_s)
    except TimeoutError:
        process.kill()
        await process.wait()
        raise SubscriptionCliError("timeout", "The subscription CLI timed out") from None
    return process.returncode or 0, out[:OUTPUT_MAX].decode("utf-8", "replace"), err[:OUTPUT_MAX].decode("utf-8", "replace")


def _classify(text: str, default: str) -> str:
    lowered = text.lower()
    if any(marker in lowered for marker in ("not logged in", "please run", "login", "log in", "unauthorized", "401", "authentication")):
        return "auth_not_configured"
    if any(marker in lowered for marker in ("usage limit", "rate limit", "429", "limit reached", "quota")):
        return "rate_limited"
    if any(marker in lowered for marker in ("context window", "context length", "prompt is too long")):
        return "context_window_exceeded"
    return default


def _work_dir() -> Path:
    """Neutral, empty working directory (no project files or instructions for the CLI to pick up)."""
    path = Path(tempfile.gettempdir()) / "courtroom-companion-cli"
    path.mkdir(parents=True, exist_ok=True)
    return path


class ClaudeCodeProvider(LLMProvider):
    type = "claude_code"
    capabilities = ProviderCapabilities(structured_output=StructuredOutputMode.NATIVE)

    def __init__(self, model: str | None = None, command: list[str] | None = None, runner=run_cli) -> None:
        super().__init__(model)
        self._command, self._runner = command, runner

    async def generate(self, request: GenerationRequest) -> RawCompletion:
        if has_attachments(request.messages):
            raise AttachmentUnsupported("The Claude subscription mode reads text evidence only; use an API profile for images and PDFs")
        command = self._command or resolve_cli("claude", "COURTROOM_CLAUDE_BIN",
                                               [("@anthropic-ai/claude-code", "bin/claude.exe"), ("@anthropic-ai/claude-code", "cli.js")])
        if not command:
            raise SubscriptionCliError("cli_not_installed", "Claude Code is not installed (npm install -g @anthropic-ai/claude-code, then claude login)")
        args = [*command, "-p", "--output-format", "json", "--json-schema", json.dumps(request.response_schema),
                "--system-prompt", request.system_prompt, "--tools", "", "--setting-sources", "",
                "--no-session-persistence"]
        if self.model:
            args += ["--model", self.model]
        code, out, err = await self._runner(args, transcript(request.messages), request.settings.timeout_s, _work_dir())
        try:
            body = json.loads(out)
        except ValueError:
            raise SubscriptionCliError(_classify(err or out, "provider_error"), "Claude Code returned no JSON result") from None
        if not isinstance(body, dict):
            raise SubscriptionCliError("malformed_response", "Claude Code returned an unexpected result")
        if body.get("is_error") or code != 0:
            detail = f"{body.get('result', '')} {body.get('api_error_status', '')} {err}"
            raise SubscriptionCliError(_classify(detail, "provider_error"), "Claude Code reported an error")
        content = body.get("structured_output")
        if content is None:
            content = body.get("result")
        return RawCompletion(content, self.model or "claude-code-subscription",
                             metadata={"stop_reason": None, "terminal_reason": body.get("terminal_reason")})


class CodexProvider(LLMProvider):
    type = "codex"
    capabilities = ProviderCapabilities(structured_output=StructuredOutputMode.NATIVE)

    def __init__(self, model: str | None = None, command: list[str] | None = None, runner=run_cli) -> None:
        super().__init__(model)
        self._command, self._runner = command, runner

    async def generate(self, request: GenerationRequest) -> RawCompletion:
        if has_attachments(request.messages):
            raise AttachmentUnsupported("The ChatGPT subscription mode reads text evidence only; use an API profile for images and PDFs")
        command = self._command or resolve_cli("codex", "COURTROOM_CODEX_BIN", [("@openai/codex", "bin/codex.js")])
        if not command:
            raise SubscriptionCliError("cli_not_installed", "Codex CLI is not installed (npm install -g @openai/codex, then codex login)")
        work = _work_dir()
        with tempfile.TemporaryDirectory(dir=work) as scratch:
            schema_path, output_path = Path(scratch) / "schema.json", Path(scratch) / "reply.json"
            schema_path.write_text(json.dumps(strict_schema(request.response_schema)), encoding="utf-8")
            args = [*command, "exec", "-", "--output-schema", str(schema_path), "-o", str(output_path),
                    "--sandbox", "read-only", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config"]
            if self.model:
                args += ["-m", self.model]
            prompt = f"{request.system_prompt}\n\n---\n\n{transcript(request.messages)}"
            code, out, err = await self._runner(args, prompt, request.settings.timeout_s, work)
            reply = output_path.read_text(encoding="utf-8") if output_path.exists() else ""
        if code != 0 or not reply.strip():
            raise SubscriptionCliError(_classify(f"{err} {out}", "provider_error"), "Codex did not produce a reply")
        return RawCompletion(reply.strip(), self.model or "codex-subscription")
