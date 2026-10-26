"""Export prompts by default; explicit --execute runs bounded scenarios via a saved profile.

Never imports user lore, writes provider settings, or modifies approved knowledge.
For live testing pass --catalog and --profile-id explicitly. Keys remain in the OS vault.
"""
import argparse
import asyncio
import json
import os
from pathlib import Path
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))

from app.artifacts.store import ArtifactStore
from app.characters.prompt import build_system_prompt, reply_schema
from app.characters.repository import CharacterRepository
from app.characters.service import CharacterService
from app.configuration.credentials import KeyringCredentialStore
from app.configuration.profiles import ProfileCatalog, ProfileManager
from app.llm.gateway import LLMGateway

SCENARIOS = ROOT / 'backend/tests/fixtures/emotional_realism_scenarios.json'


async def evaluate(args):
    pack = json.loads(SCENARIOS.read_text(encoding='utf-8'))
    cases = [c for c in pack['cases'] if not args.case or c['id'] in args.case]
    if not cases or (args.case and set(args.case) - {c['id'] for c in cases}):
        raise ValueError('Unknown case; see the scenario JSON for IDs')
    calls = sum(len(c['turns']) for c in cases)
    if args.execute and (not args.catalog or not args.profile_id or calls > args.max_calls):
        raise ValueError(f'Live run needs explicit --catalog, --profile-id, and selection within --max-calls (selected {calls})')
    if args.out.exists():
        raise ValueError('Output already exists; choose a fresh filename to preserve earlier evidence')
    previous = os.environ.get('COURTROOM_EMOTIONAL_BOUNDARIES')
    os.environ['COURTROOM_EMOTIONAL_BOUNDARIES'] = '0' if args.baseline else '1'
    report = {'condition':'baseline' if args.baseline else 'pilot', 'executed':args.execute,
              'calls':0, 'rubric':pack['rubric'], 'cases':[]}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    try:
        with tempfile.TemporaryDirectory(prefix='emotional-evaluation-') as sandbox:
            repo = CharacterRepository(ROOT/'frontend/public/assets', knowledge_dir=Path(sandbox)/'knowledge')
            service = None
            if args.execute:
                # Parse read-only. Constructing ProfileStore could create/write a missing catalogue.
                catalog = ProfileCatalog.model_validate_json(args.catalog.read_text(encoding='utf-8'))
                profile = next((p for p in catalog.profiles if p.id == args.profile_id), None)
                if profile is None:
                    raise ValueError('Profile ID not found')
                config = ProfileManager.configuration(profile)
                if profile.credential_ref:
                    config.bind_credential(KeyringCredentialStore().get(profile.credential_ref))
                gateway = LLMGateway(config)
                report['provider'] = {'type':config.type, 'model':config.model,
                                      'temperature':config.settings.temperature, 'maxTokens':config.settings.max_tokens}
                service = CharacterService(repo, gateway)
            store = ArtifactStore(args.out.parent / f'{args.out.stem}-artifacts') if args.execute else None
            for index, case in enumerate(cases):
                entry = {'id':case['id'], 'review':case['review'], 'turns':[]}
                report['cases'].append(entry)
                if not args.execute:
                    profile = repo.get(case['character'])
                    entry.update(systemPrompt=build_system_prompt(profile, case['language']),
                                 schema=reply_schema(profile), userInputs=case['turns'])
                    continue
                for message in case['turns']:
                    start = time.monotonic()
                    result = await service.chat(case['character'], message, f'evaluation-{index}',
                                                language=case['language'], artifact_store=store)
                    report['calls'] += 1
                    entry['turns'].append({'user':message,'reply':result.reply.model_dump(by_alias=True) if result.reply else None,
                                           'performance':result.performance,'error':result.error,
                                           'artifacts':result.artifacts,'elapsedMs':round((time.monotonic()-start)*1000)})
                    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
                    print(f"{case['id']}: turn {len(entry['turns'])}, error={result.error or 'none'}", flush=True)
                    if result.error:
                        raise RuntimeError('Provider failure; run stopped to avoid repeated paid failures. Partial evidence saved.')
            args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    finally:
        if previous is None:
            os.environ.pop('COURTROOM_EMOTIONAL_BOUNDARIES', None)
        else:
            os.environ['COURTROOM_EMOTIONAL_BOUNDARIES'] = previous


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--case', action='append', help='Repeat to select cases; default exports all')
    parser.add_argument('--baseline', action='store_true')
    parser.add_argument('--execute', action='store_true', help='Explicit consent to configured-provider calls, which may cost money')
    parser.add_argument('--catalog', type=Path)
    parser.add_argument('--profile-id')
    parser.add_argument('--max-calls', type=int, choices=range(1,17), default=8)
    parser.add_argument('--out', type=Path, required=True, help='Use an ignored build/ path; never publish private transcripts')
    asyncio.run(evaluate(parser.parse_args()))
