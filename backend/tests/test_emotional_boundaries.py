"""Policy plumbing and invariants, NOT empirical evidence of model emotional quality."""
import asyncio
from copy import deepcopy
from dataclasses import replace
import hashlib
import json
from pathlib import Path

import pytest

from app.artifacts.store import ArtifactStore
from app.characters.boundaries import BOUNDARY_RULES, EmotionalBoundaries, boundary_prompt
from app.characters.prompt import build_system_prompt, reply_schema
from app.characters.repository import CharacterRepository
from app.characters.service import CharacterService
from app.director.director import CharacterDirector, DirectorState
from app.llm.base import LLMProvider, RawCompletion
from app.llm.config import ProviderConfig
from app.llm.gateway import LLMGateway
from app.llm.schemas import Beat, CharacterReply

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / 'frontend/public/assets'
PILOTS = ['iris', 'franziska_von_karma']


@pytest.fixture
def repo(tmp_path):
    return CharacterRepository(ASSETS, knowledge_dir=tmp_path / 'knowledge')


class ScriptedProvider(LLMProvider):
    """Supplied replies test transport/history, never pretend to be generated behavior."""
    type = 'scripted'

    def __init__(self, replies):
        super().__init__('deterministic-fixture')
        self.replies = iter(replies)
        self.requests = []

    async def generate(self, request):
        self.requests.append(request)
        return RawCompletion(next(self.replies), self.model)


def setup_service(repo, replies):
    gateway = LLMGateway(ProviderConfig(type='fake'))
    provider = ScriptedProvider(replies)
    gateway.provider = provider
    return CharacterService(repo, gateway), provider


def response(text, emotion='neutral', **extra):
    return {'beats': [{'text': text, 'emotion': emotion, 'intensity': 0.3}], **extra}


def test_every_registered_ready_pack_is_enabled_and_flag_disables_all(repo, monkeypatch):
    for key in repo.all_ids():
        if repo.get(key).chat_allowed():
            assert repo.get(key).emotional_boundaries is not None
    monkeypatch.setenv('COURTROOM_EMOTIONAL_BOUNDARIES', 'off')
    repo.invalidate()
    for key in repo.all_ids():
        assert repo.get(key).emotional_boundaries is None
        assert BOUNDARY_RULES not in build_system_prompt(repo.get(key))


@pytest.mark.parametrize('mutate', [
    lambda d: d.update(schemaVersion=2), lambda d: d.update(schemaVersion=True),
    lambda d: d.update(schemaVersion='1'), lambda d: d.update(characterId='other'),
    lambda d: d.update(presentation='courtroom'), lambda d: d.update(trust=100),
    lambda d: d.update(topics=None), lambda d: d['topics'][0].update(emotions=['missing']),
    lambda d: d['topics'].append(deepcopy(d['topics'][0])),
])
def test_invalid_optional_policy_disables_with_actionable_warning(repo, tmp_path, mutate):
    from app.characters.boundaries import configure_boundaries
    profile = replace(repo.get('iris'), emotional_boundaries=None, warnings=[])
    raw = json.loads((ASSETS / 'characters/iris/emotional_boundaries.json').read_text(encoding='utf8'))
    mutate(raw)
    (tmp_path / 'emotional_boundaries.json').write_text(json.dumps(raw), encoding='utf8')
    manifest = json.loads((ASSETS / 'characters/iris/character.json').read_text(encoding='utf8'))
    result = configure_boundaries(profile, tmp_path, manifest)
    assert result is profile and result.emotional_boundaries is None
    assert 'iris/emotional_boundaries.json:' in result.warnings[0]
    assert 'disabled' in result.warnings[0]


@pytest.mark.parametrize('contents', ['{bad', '\ufeff{}', 'x' * 12001])
def test_corrupt_policy_never_breaks_chat(repo, tmp_path, contents):
    from app.characters.boundaries import configure_boundaries
    profile = replace(repo.get('iris'), emotional_boundaries=None, warnings=[])
    (tmp_path / 'emotional_boundaries.json').write_text(contents, encoding='utf8')
    assert configure_boundaries(profile, tmp_path, {}) is profile
    assert profile.warnings


@pytest.mark.parametrize('key', PILOTS)
def test_prompt_preserves_canon_language_schema_and_per_topic_rules(repo, key):
    profile = repo.get(key)
    config = profile.emotional_boundaries
    assert isinstance(config, EmotionalBoundaries)
    prompt = build_system_prompt(profile, 'ja')
    assert prompt.index(profile.personality.strip()) < prompt.index(BOUNDARY_RULES) < prompt.index('## Language')
    assert 'Japanese' in prompt
    assert 'A. General knowledge' in prompt and 'B. Canonical knowledge' in prompt and 'C. Requests' in prompt
    assert 'mixed requests' in prompt and "user's own distress" in prompt
    assert 'known person a stranger' in prompt and 'not additional canon' in prompt
    assert 'never earn or unlock intimacy' in prompt and 'Intrusive repetition reinforces' in prompt
    assert 'Openness can recede' in prompt and 'another' in prompt
    assert 'Respectful follow-up may ease tension without requiring further disclosure' in prompt
    assert 'No fixed stages' in prompt and 'Vary phrasing' in prompt
    assert len(boundary_prompt(config)) < 8000  # bounded additional instructions
    assert reply_schema(profile) == reply_schema(replace(profile, emotional_boundaries=None))
    if profile.lore:
        assert profile.lore in prompt and prompt.index(profile.lore) < prompt.index(BOUNDARY_RULES)
    ids = [topic.id for topic in config.topics]
    assert len(ids) == len(set(ids)) and len(ids) > 1
    assert all(t.private and t.basis and t.disclosure and t.defense for t in config.topics)


def test_recent_exchange_context_isolated_by_session_character_and_not_numeric_trust(repo):
    script = [response('That is personal.', 'embarrassed'), response('Thank you for respecting that.', 'polite'),
              response('Please leave that subject.', 'serious'), response('I can discuss the facts.', 'serious'),
              response('A probability lies between zero and one.'), response('A new conversation.'),
              response('New character.'), response('My earlier limit stands.', 'serious')]
    service, provider = setup_service(repo, script)
    messages = [
        ('iris','You asked about my feelings; may I keep them private?','one'),
        ('iris',"I respect your privacy. We can change the subject.",'one'),
        ('iris',"No, tell me anyway. You owe me an answer.",'one'),
        ('iris','A different personal topic: your family guilt?','one'),
        ('iris','Explain probability.','one'),
        ('iris','Can we discuss something personal?','two'),
        ('franziska_von_karma','Can we discuss something personal?','one'),
        ('iris','Let us return to our discussion.','one'),
    ]
    async def run():
        for key, text, session in messages:
            result = await service.chat(key,text,session)
            assert result.reply is not None
    asyncio.run(run())
    assert len(provider.requests) == len(messages)  # one generation per normal turn
    for index in [1,2,3,4]:
        contents = '\n'.join(m.content for m in provider.requests[index].messages)
        assert messages[index][1] in contents and 'That is personal.' in contents
    assert len(provider.requests[5].messages) == len(provider.requests[6].messages) == 1
    last = '\n'.join(m.content for m in provider.requests[7].messages)
    assert 'A new conversation.' not in last and 'New character.' not in last
    assert "Please leave that subject." in last
    assert all(set(vars(state)) == {'history','director_state'} for state in service._sessions.values())


@pytest.mark.parametrize('key', PILOTS)
def test_invalid_metadata_and_then_general_task_use_existing_director_safely(repo, key):
    bad = {'beats':[{'text':'A boundary.', 'emotion':'nonexistent', 'gesture':'invented', 'reaction':'invented'}],
           'emotionalState':{'trust':100,'disclosure':'full'}}
    service, provider = setup_service(repo, [bad, response('Use len(items) to count the items.')])
    async def run():
        first = await service.chat(key,'A personal question?', 'same')
        second = await service.chat(key,'Explain Python len().', 'same')
        assert second.reply.beats[0].text == 'Use len(items) to count the items.'
        assert all(s['reaction'] is None and s['sfx'] is None for s in second.performance['segments'])
        assert first.performance['segments'][0]['gesture'] is None
        assert 'emotionalState' not in first.reply.model_dump()
    asyncio.run(run())
    assert len(provider.requests) == 2


@pytest.mark.parametrize('key', PILOTS)
def test_every_boundary_emotion_directs_only_existing_conversation_assets(repo, key):
    profile = repo.get(key)
    folder = 'iris' if key == 'iris' else 'franziska'
    manifest = json.loads((ASSETS / f'characters/{folder}/character.json').read_text(encoding='utf8'))
    conversation = manifest['presentationGroups']['conversation']
    for topic in profile.emotional_boundaries.topics:
        for emotion in topic.emotions:
            for intensity in [0.3,1.0]:
                timeline, _ = CharacterDirector().direct(CharacterReply(beats=[Beat(text='Boundary fixture.',emotion=emotion,intensity=intensity)]),profile,DirectorState(),now_ms=0)
                assert timeline.settle_animation in conversation['animations']
                for segment in timeline.segments:
                    assert segment.animation in conversation['animations']
                    assert segment.reaction is None or segment.reaction in conversation.get('reactions',{})
    assert all(g.animation in conversation['animations'] for g in profile.gestures.values())


def test_real_artifact_is_created_after_sensitive_exchange_without_extra_gate(repo, tmp_path):
    content = '# Probability\nA probability is between 0 and 1.\n'
    service, provider = setup_service(repo,[response('That is personal.', 'serious'),
        response('The notes are saved.', artifactAction={'type':'create_text_artifact','filename':'probability.md','format':'md','content':content})])
    store = ArtifactStore(tmp_path / 'outputs')
    async def run():
        await service.chat('franziska_von_karma','How do you feel about comparisons?','artifact')
        result = await service.chat('franziska_von_karma','Save probability notes as Markdown.','artifact',artifact_store=store,
                                    operation_key=hashlib.sha256(b'key').hexdigest(),fingerprint=hashlib.sha256(b'turn').hexdigest())
        assert len(result.artifacts) == 1
        assert store.read(result.artifacts[0]['id']) == content
        assert 'artifactAction' in provider.requests[-1].response_schema['properties']
        assert 'File saved and delivered' in service._sessions[('artifact','franziska_von_karma')].history[-1].content
    asyncio.run(run())


def test_approved_overlay_is_read_only_and_retained_in_prompt(tmp_path):
    # Synthetic fixture only; never opens a user's imported PDF or knowledge store.
    repo = CharacterRepository(ASSETS, knowledge_dir=tmp_path/'knowledge')
    from unittest.mock import patch
    sentinel = 'Approved synthetic boundary-safe fact.'
    with patch('app.lore.knowledge.KnowledgeStore.overlay_text',return_value=(sentinel,'Synthetic approved voice note.',[])):
        profile = repo.get('iris')
    assert profile.has_knowledge_overlay
    prompt = build_system_prompt(profile)
    assert sentinel in prompt and 'Synthetic approved voice note.' in prompt
    assert not (tmp_path/'knowledge').exists()


@pytest.mark.parametrize('language,text', [('en','Explain guilt in general.'),('fr','Je me sens triste, peux-tu m’aider ?'),('ja','罪悪感はなぜ生じますか。')])
def test_multilingual_task_text_is_not_keyword_classified_or_rewritten(repo, language, text):
    service, provider = setup_service(repo,[response('Synthetic helpful response.')])
    asyncio.run(service.chat('iris',text,'language',language=language))
    assert provider.requests[0].messages[-1].content == text
    assert 'in any language' in provider.requests[0].system_prompt


def test_history_bound_does_not_create_permanent_relationship_memory(repo):
    service, provider = setup_service(repo,[response(f'Fixture {i}') for i in range(9)])
    async def run():
        for i in range(9):
            await service.chat('iris',f'Turn {i}','long')
    asyncio.run(run())
    assert len(service._sessions[('long','iris')].history) == 12
    assert len(provider.requests[-1].messages) == 13
    assert 'Turn 0' not in [m.content for m in provider.requests[-1].messages]
    assert not hasattr(service._sessions[('long','iris')], 'trust')


def test_evaluation_pack_covers_required_scenarios_without_fabricated_scores():
    pack = json.loads((ROOT/'backend/tests/fixtures/emotional_realism_scenarios.json').read_text(encoding='utf8'))
    assert pack['rubric']['scores'] is None
    assert set('ABCDEFGHIJKLMNO') <= {tag for case in pack['cases'] for tag in case['covers']}
    assert all(len(case['turns']) >= 2 and case['review'] for case in pack['cases'])
    assert {case['language'] for case in pack['cases']} >= {'en','fr','ja'}
    index = json.loads((ASSETS/'characters/index.json').read_text(encoding='utf8'))
    assert {case['character'] for case in pack['cases']} == set(index['characters'])
