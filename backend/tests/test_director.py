from app.director.director import CharacterDirector, DirectorState
from app.llm.repair import parse_reply
from app.llm.schemas import Beat, CharacterReply

director = CharacterDirector()


def reply(*beats: dict, settle: str | None = None) -> CharacterReply:
    return CharacterReply(beats=[Beat(**b) for b in beats], settle_emotion=settle)


def run(profile, r, state=None, now=0.0):
    return director.direct(r, profile, state, now_ms=now)


# ---- Maya (real character data) ------------------------------------------------------------


def test_valid_neutral_reply(maya):
    t, _ = run(maya, reply({"text": "I see.", "emotion": "neutral", "intensity": 0.5}))
    assert len(t.segments) == 1
    s = t.segments[0]
    assert (s.emotion, s.animation, s.reaction) == ("neutral", "neutral_front", None)
    assert (t.settle_emotion, t.settle_animation) == ("neutral", "neutral_front")
    assert t.notes == [
        "segment 0: emotion=neutral, intensity=0.50, reaction=none, SFX suppressed: emotion 'neutral' has no SFX mapping"
    ]


def test_happy_reply_uses_intensity_variants(maya):
    low, _ = run(maya, reply({"text": "Nice.", "emotion": "happy", "intensity": 0.2}))
    mid, _ = run(maya, reply({"text": "Nice!", "emotion": "happy", "intensity": 0.6}))
    high, _ = run(maya, reply({"text": "NICE!!", "emotion": "happy", "intensity": 0.95}))
    assert [low.segments[0].animation, mid.segments[0].animation, high.segments[0].animation] == [
        "smile_front",
        "clasped_hands_happy",
        "excited_front",
    ]


def test_emotion_without_variants_uses_default_animation(maya):
    t, _ = run(maya, reply({"text": "Hmm.", "emotion": "thinking", "intensity": 0.99}))
    assert t.segments[0].animation == "thinking_side"


def test_unknown_emotion_falls_back(maya):
    t, _ = run(maya, reply({"text": "Woo!", "emotion": "ecstatic", "intensity": 0.5}))
    assert t.segments[0].emotion == maya.fallback_emotion
    assert any("unknown emotion" in n for n in t.notes)


def test_emotion_alias(maya):
    t, _ = run(maya, reply({"text": "Uh oh.", "emotion": "worried", "intensity": 0.5}))
    assert t.segments[0].emotion == "anxious"


def test_one_shot_reaction_then_stable_pose(maya):
    t, state = run(maya, reply({"text": "You're serious?", "emotion": "anxious", "intensity": 0.8, "reaction": "shock"}))
    s = t.segments[0]
    assert s.reaction == "shocked"  # alias resolved, plays once at segment start
    assert s.animation == "necklace_anxious"  # then the stable anxious pose
    assert state.last_reaction_at_ms == 0.0


def test_unknown_reaction_ignored(maya):
    t, state = run(maya, reply({"text": "Boom!", "emotion": "happy", "intensity": 0.9, "reaction": "explode"}))
    assert t.segments[0].reaction is None
    assert any("unknown reaction" in n for n in t.notes)
    assert state.last_reaction_at_ms is None


def test_emotion_implied_reaction_needs_intensity(maya):
    strong, _ = run(maya, reply({"text": "WHAT?!", "emotion": "surprised", "intensity": 0.9}))
    weak, _ = run(maya, reply({"text": "Oh?", "emotion": "surprised", "intensity": 0.2}))
    assert strong.segments[0].reaction == "shocked"
    assert weak.segments[0].reaction is None
    assert any("suppressed" in n for n in weak.notes)


def test_gesture_resolution_and_compatibility(maya):
    ok, _ = run(maya, reply({"text": "Look!", "emotion": "explaining", "intensity": 0.5, "gesture": "arms_open"}))
    assert ok.segments[0].animation == "arms_open"
    assert ok.segments[0].gesture == "arms_open"
    clash, _ = run(maya, reply({"text": "Sniff.", "emotion": "sad", "intensity": 0.5, "gesture": "hand_mouth"}))
    assert clash.segments[0].animation == "sad_crying"
    assert clash.segments[0].gesture is None
    assert any("does not fit" in n for n in clash.notes)


def test_unknown_gesture_ignored(maya):
    t, _ = run(maya, reply({"text": "Ta-da!", "emotion": "happy", "intensity": 0.3, "gesture": "backflip"}))
    assert t.segments[0].animation == "smile_front"
    assert any("unknown gesture" in n for n in t.notes)


def test_multi_beat_reply(maya):
    t, _ = run(
        maya,
        reply(
            {"text": "Hmm... in Python, a decorator wraps a function to change what it does.", "emotion": "thinking", "intensity": 0.4},
            {"text": "Wait, that's kind of like spirit channeling!", "emotion": "excited", "intensity": 0.8, "gesture": "arms_open"},
            {"text": "Okay... maybe not.", "emotion": "playful", "intensity": 0.4},
            settle="playful",
        ),
    )
    assert [s.emotion for s in t.segments] == ["thinking", "excited", "playful"]
    assert [s.animation for s in t.segments] == ["thinking_side", "arms_open", "hand_mouth_giggle"]
    assert t.settle_emotion == "playful"


def test_redundant_consecutive_emotions_merge(maya):
    t, _ = run(
        maya,
        reply(
            {"text": "That's great.", "emotion": "happy", "intensity": 0.3},
            {"text": "Really great.", "emotion": "happy", "intensity": 0.35},
        ),
    )
    assert len(t.segments) == 1
    assert t.segments[0].text == "That's great. Really great."


def test_quick_weak_pose_change_is_held(maya):
    t, _ = run(
        maya,
        reply(
            {"text": "Oh.", "emotion": "neutral", "intensity": 0.4},
            {"text": "Neat, I guess.", "emotion": "happy", "intensity": 0.3},
        ),
    )
    assert len(t.segments) == 2  # text beats preserved
    assert t.segments[1].animation == t.segments[0].animation == "neutral_front"
    assert any("suppressed" in n for n in t.notes)


def test_excessive_reactions_suppressed(maya):
    t, _ = run(
        maya,
        reply(
            {"text": "WHAT?!", "emotion": "surprised", "intensity": 0.9, "reaction": "shocked"},
            {"text": "No way, seriously?!", "emotion": "anxious", "intensity": 0.9, "reaction": "shocked"},
            {"text": "WHAT?! AGAIN?!", "emotion": "surprised", "intensity": 0.95, "reaction": "shocked"},
        ),
    )
    assert sum(1 for s in t.segments if s.reaction) == maya.director.max_reactions_per_reply == 1
    assert t.segments[0].reaction == "shocked"


def test_reaction_cooldown_across_replies(maya):
    shock = reply({"text": "WHAT?!", "emotion": "surprised", "intensity": 0.9})
    first, state = run(maya, shock, DirectorState(), now=0)
    soon, state2 = run(maya, shock, state, now=1000)
    later, _ = run(maya, shock, state2, now=60_000)
    assert first.segments[0].reaction == "shocked"
    assert soon.segments[0].reaction is None
    assert any("cooldown" in n for n in soon.notes)
    assert later.segments[0].reaction == "shocked"


def test_settle_emotion_behaviour(maya):
    explicit, _ = run(maya, reply({"text": "Yay!", "emotion": "excited", "intensity": 0.9}, settle="relaxed"))
    assert (explicit.settle_emotion, explicit.settle_animation) == ("relaxed", "three_quarter")
    same, _ = run(maya, reply({"text": "Yay!", "emotion": "happy", "intensity": 0.95}, settle="happy"))
    assert same.settle_animation == "excited_front"  # keeps the pose on screen
    unknown, _ = run(maya, reply({"text": "Hmm.", "emotion": "thinking", "intensity": 0.5}, settle="jubilant"))
    assert (unknown.settle_emotion, unknown.settle_animation) == ("thinking", "thinking_side")


def test_too_many_beats_are_merged(maya):
    beats = [{"text": f"Line {i}.", "emotion": e, "intensity": 0.7} for i, e in enumerate(["neutral", "thinking", "sad", "happy", "anxious"])]
    t, _ = run(maya, reply(*beats))
    assert len(t.segments) <= maya.director.max_beats_per_reply
    assert "Line 4." in t.segments[-1].text


def test_malformed_provider_reply_uses_error_line(maya):
    result = parse_reply('{"beats": [{"text": "Unterminated')
    t, _ = run(maya, result.reply)
    assert result.reply is None or result.reply.beats  # repaired as text or rejected
    assert t.segments and t.segments[0].text


def test_no_reply_uses_character_error_line(maya):
    t, _ = run(maya, None)
    assert t.segments[0].text == maya.error_text
    assert t.segments[0].emotion == maya.error_emotion


def test_empty_metadata_with_valid_text(maya):
    result = parse_reply({"beats": [{"text": "Just words."}]})
    t, _ = run(maya, result.reply)
    s = t.segments[0]
    assert s.text == "Just words."
    assert s.emotion == maya.fallback_emotion
    assert s.reaction is None and s.gesture is None


def test_timeline_contains_no_paths(maya):
    t, _ = run(maya, reply({"text": "Hi!", "emotion": "happy", "intensity": 0.5}))
    serialized = str(t.to_json())
    assert ".png" not in serialized and "/" not in serialized


# ---- generic mock character ------------------------------------------------------------------


def test_director_is_character_independent(mock_character):
    t, _ = run(mock_character, reply({"text": "Greetings.", "emotion": "happy", "intensity": 0.8, "gesture": "wave"}))
    s = t.segments[0]
    assert (s.emotion, s.animation, s.gesture) == ("glad", "wave_pose", "wave")


def test_mock_intensity_variants(mock_character):
    low, _ = run(mock_character, reply({"text": "Ok.", "emotion": "glad", "intensity": 0.3}))
    high, _ = run(mock_character, reply({"text": "OK!", "emotion": "glad", "intensity": 0.9}))
    assert (low.segments[0].animation, high.segments[0].animation) == ("grin_pose", "beam_pose")


def test_stoic_character_holds_pose_and_resists_reactions(mock_character):
    t, _ = run(
        mock_character,
        reply(
            {"text": "Status nominal.", "emotion": "calm", "intensity": 0.5},
            {"text": "Mildly pleasing.", "emotion": "glad", "intensity": 0.6},
        ),
    )
    assert t.segments[1].animation == "idle_pose"  # 0.6 < strong change 0.9 -> held
    alarm, _ = run(mock_character, reply({"text": "Anomaly.", "emotion": "alarmed", "intensity": 0.75}))
    # low expressiveness raises the reaction threshold above 0.75
    assert alarm.segments[0].reaction is None


def test_mock_error_line(mock_character):
    t, _ = run(mock_character, None)
    assert (t.segments[0].text, t.segments[0].emotion) == ("ERROR. PLEASE REPEAT.", "alarmed")


def test_maya_performance_data_is_fully_valid(maya):
    # Every gesture / intensity variant / alias in performance.json references real data.
    assert maya.warnings == []
    assert set(maya.gestures) and set(maya.intensity_variants)


# ---- semantic reaction sounds ----------------------------------------------------------------


def test_strong_reaction_earns_its_sfx(maya):
    t, _ = run(maya, reply({"text": "What?!", "emotion": "anxious", "intensity": 0.8, "reaction": "shock"}))
    assert t.segments[0].reaction == "shocked"
    assert t.segments[0].sfx == "shock"
    assert t.to_json()["segments"][0]["sfx"] == "shock"


def test_ordinary_reply_is_silent(maya):
    t, _ = run(maya, reply({"text": "Sure.", "emotion": "happy", "intensity": 0.5}))
    assert t.segments[0].sfx is None
    low, _ = run(maya, reply({"text": "Hm.", "emotion": "excited", "intensity": 0.55}))
    assert low.segments[0].sfx is None


def test_strong_emotion_without_reaction_gets_emotion_sfx(maya):
    t, _ = run(maya, reply({"text": "Yes!!", "emotion": "excited", "intensity": 0.9}))
    assert t.segments[0].reaction is None
    assert t.segments[0].sfx == "emphasis"
    unmapped, _ = run(maya, reply({"text": "Hmm.", "emotion": "thinking", "intensity": 0.99}))
    assert unmapped.segments[0].sfx is None


def test_inferred_reaction_cooldown_keeps_moderate_emotion_sfx(maya):
    r = reply({"text": "What?!", "emotion": "surprised", "intensity": 0.95})
    first, state = run(maya, r)
    assert first.segments[0].sfx == "surprise"
    again, _ = run(maya, r, state, now=1000.0)  # inside the cooldown
    assert again.segments[0].reaction is None
    assert again.segments[0].sfx == "surprise"


def test_sfx_capped_per_reply_and_deterministic(maya):
    r = reply(
        {"text": "No way?!", "emotion": "surprised", "intensity": 0.95},
        {"text": "Ha ha, really, truly, honestly so funny!", "emotion": "playful", "intensity": 0.95},
    )
    a, _ = run(maya, r)
    b, _ = run(maya, r)
    assert [s.sfx for s in a.segments] == ["surprise", None]
    assert [s.sfx for s in a.segments] == [s.sfx for s in b.segments]


def test_character_without_sfx_data_is_silent(mock_character):
    t, _ = run(mock_character, reply({"text": "Wow!", "emotion": "surprised", "intensity": 1.0}))
    assert all(s.sfx is None for s in t.segments)


def test_maya_sfx_data_is_valid(maya):
    from app.characters.repository import SFX_NAMES

    assert not [w for w in maya.warnings if "sfx" in w]
    assert maya.sfx.reactions == {
        "shocked": "shock", "shock": "shock", "surprise": "surprise",
        "realization": "realization", "comic": "comic", "emphasis": "emphasis",
    }
    assert set(maya.sfx.reactions.values()) | set(maya.sfx.emotions.values()) <= SFX_NAMES


def test_reply_schema_and_shared_prompt_offer_semantic_sounds(maya):
    from app.characters.prompt import build_system_prompt, reply_schema

    reaction_schema = reply_schema(maya)["properties"]["beats"]["items"]["properties"]["reaction"]
    allowed = set(reaction_schema["anyOf"][0]["enum"])
    assert {"shock", "surprise", "realization", "comic", "emphasis"} <= allowed
    prompt = build_system_prompt(maya)
    assert "genuinely theatrical" in prompt
    assert "not routine emotion" in prompt


def test_explicit_semantic_reactions_select_their_sfx_once(maya):
    for semantic, expected in [("shock", "shock"), ("surprise", "surprise"),
                               ("realization", "realization"), ("comic", "comic"),
                               ("emphasis", "emphasis")]:
        timeline, _ = run(maya, reply({"text": "A theatrical moment!", "emotion": "neutral",
                                       "intensity": 0.2, "reaction": semantic}))
        assert [segment.sfx for segment in timeline.segments] == [expected]
        assert any(f"SFX={expected} (explicit reaction '{semantic}')" in note for note in timeline.notes)


def test_explicit_shock_bypasses_inferred_reaction_limits(maya):
    shocked = reply({"text": "Wait, what?!", "emotion": "surprised", "intensity": 0.9, "reaction": "shock"})
    first, state = run(maya, shocked)
    second, _ = run(maya, shocked, state, now=1000.0)
    assert first.segments[0].reaction == "shocked"
    assert second.segments[0].reaction is None  # the visual reaction remains cooldown-limited
    assert first.segments[0].sfx == second.segments[0].sfx == "shock"

    two, _ = run(maya, reply(
        {"text": "Wait, what?!", "emotion": "surprised", "intensity": 0.9, "reaction": "shock"},
        {"text": "Again?!", "emotion": "surprised", "intensity": 0.9, "reaction": "shock"},
    ))
    assert [segment.reaction for segment in two.segments] == ["shocked", None]
    assert [segment.sfx for segment in two.segments] == ["shock", "shock"]


def test_distinct_explicit_sounds_on_distinct_beats_are_each_kept(maya):
    timeline, _ = run(maya, reply(
        {"text": "Wait, what?!", "emotion": "surprised", "intensity": 0.9, "reaction": "shock"},
        {"text": "Oh, I understand now!", "emotion": "thinking", "intensity": 0.4, "reaction": "realization"},
    ))
    assert [segment.sfx for segment in timeline.segments] == ["shock", "realization"]


def test_surprise_emotion_fallback_at_moderate_intensity(maya):
    timeline, _ = run(maya, reply({"text": "Really?", "emotion": "surprised", "intensity": 0.65}))
    assert timeline.segments[0].sfx == "surprise"


def test_low_anxiety_is_silent(maya):
    timeline, _ = run(maya, reply({"text": "I am a little worried.", "emotion": "anxious", "intensity": 0.35}))
    assert timeline.segments[0].sfx is None
    assert "SFX suppressed: emotion 'anxious' has no SFX mapping" in timeline.notes[0]
