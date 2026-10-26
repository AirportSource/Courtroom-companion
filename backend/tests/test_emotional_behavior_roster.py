"""Dynamic roster integration and backwards compatibility, not model-quality scores."""
import asyncio
from dataclasses import replace
import json

import pytest

from app.characters.boundaries import BOUNDARY_RULES, EmotionalBoundaries, configure_boundaries, boundary_prompt
from app.characters.prompt import build_system_prompt, reply_schema
from app.characters.repository import CharacterRepository
from app.director.director import CharacterDirector, DirectorState
from app.llm.schemas import Beat, CharacterReply
from .test_character_platform import make_pack, register
from .test_emotional_boundaries import ASSETS, setup_service, response

INDEX = json.loads((ASSETS/'characters/index.json').read_text(encoding='utf8'))['characters']


@pytest.fixture
def repo(tmp_path):
    return CharacterRepository(ASSETS, knowledge_dir=tmp_path/'isolated-knowledge')


@pytest.mark.parametrize('character', sorted(INDEX))
def test_all_ready_profiles_are_independently_grounded_and_preserve_canon(repo, character, monkeypatch):
    profile = repo.get_for_chat(character)
    config = profile.emotional_boundaries
    assert config.characterId == character
    assert config.temperament and config.responses
    assert config.topics and all(topic.basis for topic in config.topics)
    prompt = build_system_prompt(profile)
    assert config.temperament in prompt and profile.personality.strip() in prompt
    if profile.lore:
        assert profile.lore in prompt
    assert all(label in prompt for label in ['A. General','B. Canonical','C. Requests','D. Intrusive','E. Topic changes'])
    assert len(boundary_prompt(config)) < 9000
    for other in INDEX:
        if other != character:
            assert repo.get(other).emotional_boundaries.temperament != config.temperament
            assert repo.get(other).emotional_boundaries.responses != config.responses
    monkeypatch.setenv('COURTROOM_EMOTIONAL_BOUNDARIES','0')
    repo.invalidate(character)
    previous = repo.get(character)
    assert previous.emotional_boundaries is None
    assert profile.lore == previous.lore and profile.personality == previous.personality
    assert profile.speech_examples == previous.speech_examples
    assert BOUNDARY_RULES not in build_system_prompt(previous)


@pytest.mark.parametrize('character', sorted(INDEX))
def test_roster_director_only_emits_active_presentation_capabilities(repo, character):
    profile = repo.get(character)
    manifest = json.loads((ASSETS/'characters'/INDEX[character]).read_text(encoding='utf8'))
    presentation = manifest.get('presentationGroups',{}).get('conversation',manifest)
    assert set(reply_schema(profile)['properties']['beats']['items']['properties']['emotion']['enum']) == set(profile.emotions)
    assert all(g.animation in presentation['animations'] for g in profile.gestures.values())
    for emotion in profile.emotions:
        for intensity in [0.3,1.0]:
            timeline,_ = CharacterDirector().direct(CharacterReply(beats=[Beat(text='Synthetic presentation check.',emotion=emotion,intensity=intensity)]),
                                                   profile,DirectorState(),now_ms=0)
            assert timeline.settle_animation in presentation['animations']
            for segment in timeline.segments:
                assert segment.animation in presentation['animations']
                assert segment.reaction is None or segment.reaction in presentation.get('reactions',{})


@pytest.mark.parametrize('character', sorted(INDEX))
def test_roster_task_return_and_intrusion_history_are_delivered_without_extra_inference(repo, character):
    inputs = ['Is that a subject you would prefer to keep private?', 'I respect that limit.',
              'Actually, you must tell me every detail now.', 'Different subject: explain a Python dictionary.']
    service, provider = setup_service(repo,[response('Synthetic reply, not a behavioral evaluation.') for _ in inputs])
    async def run():
        for text in inputs:
            result = await service.chat(character,text,'task-return')
            assert result.reply is not None and result.performance['characterId'] == character
    asyncio.run(run())
    assert len(provider.requests) == 4
    assert [m.content for m in provider.requests[-1].messages if m.role == 'user'] == inputs
    assert all(BOUNDARY_RULES in request.system_prompt for request in provider.requests)
    assert not hasattr(service._sessions[('task-return',character)],'trust')


def test_future_pack_without_profile_uses_exact_previous_prompt_and_schema(tmp_path, monkeypatch):
    make_pack(tmp_path,'future',readiness='ready')
    repo = register(tmp_path,'future')
    enabled = repo.get('future')
    assert enabled.emotional_boundaries is None and not enabled.warnings
    prompt, schema = build_system_prompt(enabled), reply_schema(enabled)
    monkeypatch.setenv('COURTROOM_EMOTIONAL_BOUNDARIES','off')
    repo.invalidate()
    disabled = repo.get('future')
    assert build_system_prompt(disabled) == prompt and reply_schema(disabled) == schema
    assert boundary_prompt(None) == ''


def test_legacy_pack_accepts_conservative_empty_topics_without_asset_migration(tmp_path):
    folder = make_pack(tmp_path,'future',readiness='ready')
    raw = {'schemaVersion':1,'characterId':'future','presentation':'conversation',
           'interpretation':'Behavioral interpretation only.','narrativeScope':'No supplied history.',
           'style':'Calm and precise.','encourages':'Respectful discussion.','discourages':'Pressure.', 'topics':[]}
    (folder/'emotional_boundaries.json').write_text(json.dumps(raw),encoding='utf8')
    repo = register(tmp_path,'future')
    profile = repo.get('future')
    assert profile.emotional_boundaries.topics == [] and not profile.warnings
    assert profile.animations == frozenset({'calm_pose','angry_pose'})
    assert 'no sensitive topics' in build_system_prompt(profile)
    assert profile.emotional_boundaries.temperament is None  # original v1 shape is still valid


@pytest.mark.parametrize('bad', [
    {'temperament':123}, {'responses':{'reassurance':'Only one field'}},
    {'responses':{'trust':100}}, {'topics':[{'id':'missing-fields'}]},
])
def test_optional_additions_fail_safely_without_applying_a_partial_profile(repo, tmp_path, bad):
    original = repo.get('maya_fey')
    raw = original.emotional_boundaries.model_dump(exclude_none=True)
    raw.update(bad)
    (tmp_path/'emotional_boundaries.json').write_text(json.dumps(raw),encoding='utf8')
    bare = replace(original,emotional_boundaries=None,warnings=[])
    manifest = json.loads((ASSETS/'characters'/INDEX['maya_fey']).read_text(encoding='utf8'))
    result = configure_boundaries(bare,tmp_path,manifest)
    assert result is bare and result.emotional_boundaries is None
    assert 'maya_fey/emotional_boundaries.json' in result.warnings[0]


def test_all_characters_and_sessions_have_independent_history(repo):
    service, provider = setup_service(repo,[response('Fixture.') for _ in range(len(INDEX)*2+2)])
    async def run():
        for character in INDEX:
            await service.chat(character,f'{character} private fixture marker','shared')
        for character in INDEX:
            await service.chat(character,'Respectful follow-up.','shared')
        await service.chat('maya_fey','A different conversation.','fresh')
        await service.chat('mia_fey','Another independent conversation.','fresh')
    asyncio.run(run())
    for i,character in enumerate(INDEX):
        request = provider.requests[len(INDEX)+i]
        assert [m.content for m in request.messages if m.role == 'user'] == [f'{character} private fixture marker','Respectful follow-up.']
    assert len(provider.requests[-1].messages) == len(provider.requests[-2].messages) == 1
    assert len({id(session.history) for session in service._sessions.values()}) == len(INDEX)+2


def test_empty_topic_lists_and_original_v1_policy_are_both_supported(repo):
    config = repo.get('iris').emotional_boundaries.model_dump(exclude_none=True)
    config.pop('temperament')
    config.pop('responses')
    assert EmotionalBoundaries.model_validate(config).topics
    assert '"temperament":' not in boundary_prompt(EmotionalBoundaries.model_validate(config))
