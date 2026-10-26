"""Character Director: turns a semantic CharacterReply into a PerformanceTimeline.

Deterministic and character-independent: everything character-specific comes from the
CharacterProfile (character.json + performance.json). The LLM proposes intent; the director
decides what the character actually does, so the performance stays valid and natural:

- emotion  = stable emotional state -> a looping animation (idle/talking)
- reaction = short one-shot event played at the start of a segment, then the stable pose
- gesture  = how an emotion is physically expressed -> overrides the animation if compatible

Anti-overacting rules (scaled by the character's expressiveness):
- redundant consecutive beats (same pose, no reaction) are merged;
- a pose is held for a minimum time unless the next beat is strong or has a reaction;
- reactions need enough intensity, are capped per reply and have a cooldown that spans replies;
- a character's signature sound (performance.json `sfx.signature`) is rare: it needs enough
  intensity, is capped per reply and stays silent for a number of replies after each use. A
  signature that `performs` a reaction (Franziska's whip) owns it: the reaction plays with its own
  effect cues when the signature fires and is dropped otherwise, so it is never partial (D-091);
- semantic sounds: an emotion fallback stays quiet while its category played in the last
  `categoryCooldownTurns` replies or another fallback in the last `fallbackCooldownTurns`, and after `droughtTurns` silent replies the
  fallback thresholds drop a little so a strong beat in a quiet stretch is heard (D-092).
"""

from dataclasses import asdict, dataclass, field
from typing import Any

from ..characters.repository import CharacterProfile
from ..llm.repair import normalize_id
from ..llm.schemas import Beat, CharacterReply

#: Extra reading time per segment on top of the per-character rate (ms).
SEGMENT_BASE_MS = 600


@dataclass
class Segment:
    text: str
    emotion: str
    #: Logical animation ID from character.json (not a file path).
    animation: str
    intensity: float
    #: One-shot reaction to play before the stable pose, or None.
    reaction: str | None = None
    gesture: str | None = None
    #: Estimated on-screen time used for pose-hold / cooldown decisions.
    estimated_ms: int = 0
    #: Semantic reaction sound (closed set, see SFX_NAMES) or None. Played by the frontend as
    #: audio event `sfx_<name>` when the segment's first page appears.
    sfx: str | None = None
    #: Explicit semantic sound request, kept separate from the visual one-shot reaction.
    explicit_sfx: str | None = field(default=None, repr=False)
    reaction_intent: str | None = field(default=None, repr=False)

    def to_json(self) -> dict[str, Any]:
        return {
            "text": self.text,
            "emotion": self.emotion,
            "animation": self.animation,
            "intensity": round(self.intensity, 3),
            "reaction": self.reaction,
            "gesture": self.gesture,
            "sfx": self.sfx,
            "estimatedMs": self.estimated_ms,
        }


@dataclass
class PerformanceTimeline:
    character_id: str
    segments: list[Segment]
    #: Stable state after the last segment (idle pose).
    settle_emotion: str
    settle_animation: str
    #: Human-readable record of every correction/suppression (debugging, never shown to users).
    notes: list[str] = field(default_factory=list)

    def to_json(self) -> dict[str, Any]:
        return {
            "characterId": self.character_id,
            "segments": [s.to_json() for s in self.segments],
            "settle": {"emotion": self.settle_emotion, "animation": self.settle_animation},
            "notes": self.notes,
        }


@dataclass
class DirectorState:
    """Per-(session, character) state carried between replies.

    Lives in CharacterService._sessions, keyed by (session id, character id), so cooldowns are per
    conversation and per character, are never shared between characters and need no history replay.
    """

    last_reaction_at_ms: float | None = None
    #: Replies directed so far in this conversation (the reply being directed is turn + 1).
    turn: int = 0
    #: Signature sound id -> turn on which it last played.
    signature_last_turn: dict[str, int] = field(default_factory=dict)
    #: Semantic sound category -> turn on which it last played.
    sfx_last_turn: dict[str, int] = field(default_factory=dict)
    #: Turn of the last emotion-fallback sound, and of the last sound of any kind.
    last_fallback_turn: int | None = None
    last_sfx_turn: int | None = None

    def to_json(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class _Resolved:
    beat: Beat
    emotion: str
    animation: str
    intensity: float
    reaction: str | None
    gesture: str | None
    explicit_sfx: str | None
    reaction_intent: str | None


class CharacterDirector:
    def direct(
        self,
        reply: CharacterReply | None,
        profile: CharacterProfile,
        state: DirectorState | None = None,
        now_ms: float = 0.0,
        language: str = "en",
        signatures: bool = True,
    ) -> tuple[PerformanceTimeline, DirectorState]:
        """`signatures=False` for non-conversational callers (inbox events) that carry no state."""
        state = state or DirectorState()
        turn = state.turn + 1
        notes: list[str] = []
        cfg = profile.director
        hold_scale = 1.5 - cfg.expressiveness  # expressive characters change pose sooner

        if reply is None or not reply.beats:
            emotion = profile.error_emotion or profile.fallback_emotion
            notes.append("no usable reply: using the character's error line")
            reply = CharacterReply(beats=[Beat(text=profile.error_text_for(language), emotion=emotion, intensity=0.4)])

        beats = list(reply.beats)
        if len(beats) > cfg.max_beats_per_reply:
            keep = cfg.max_beats_per_reply
            tail = " ".join(b.text for b in beats[keep - 1 :])
            notes.append(f"{len(beats)} beats > max {keep}: merged the extra beats into the last one")
            beats = beats[: keep - 1] + [beats[keep - 1].model_copy(update={"text": tail})]

        resolved = [self._resolve(beat, profile, notes, i) for i, beat in enumerate(beats)]
        segments = self._merge(resolved, profile, hold_scale, notes)
        last_reaction = self._apply_reactions(segments, profile, state, now_ms, notes).last_reaction_at_ms
        signature_last = dict(state.signature_last_turn)
        sounds = DirectorState(sfx_last_turn=dict(state.sfx_last_turn), last_fallback_turn=state.last_fallback_turn,
                               last_sfx_turn=state.last_sfx_turn)
        self._apply_sfx(segments, profile, notes, turn, signature_last if signatures else None, sounds)
        settle_emotion, settle_animation = self._settle(reply, segments, profile, notes)
        new_state = DirectorState(last_reaction_at_ms=last_reaction, turn=turn, signature_last_turn=signature_last,
                                  sfx_last_turn=sounds.sfx_last_turn, last_fallback_turn=sounds.last_fallback_turn,
                                  last_sfx_turn=sounds.last_sfx_turn)
        return PerformanceTimeline(profile.id, segments, settle_emotion, settle_animation, notes), new_state

    # ---- per-beat resolution -------------------------------------------------------------

    def _resolve(self, beat: Beat, profile: CharacterProfile, notes: list[str], i: int) -> _Resolved:
        raw_emotion = normalize_id(beat.emotion)
        emotion = profile.emotion_aliases.get(raw_emotion or "", raw_emotion)
        if emotion not in profile.emotions:
            if beat.emotion:
                notes.append(f"beat {i}: unknown emotion '{beat.emotion}' -> '{profile.fallback_emotion}'")
            emotion = profile.fallback_emotion
        binding = profile.emotions[emotion]
        intensity = min(1.0, max(0.0, beat.intensity))

        gesture = None
        raw_gesture = normalize_id(beat.gesture)
        if raw_gesture:
            g = profile.gestures.get(raw_gesture)
            if g is None:
                notes.append(f"beat {i}: unknown gesture '{raw_gesture}' ignored")
            elif g.emotions and emotion not in g.emotions:
                notes.append(f"beat {i}: gesture '{raw_gesture}' does not fit emotion '{emotion}', ignored")
            else:
                gesture = raw_gesture

        if gesture:
            animation = profile.gestures[gesture].animation
        else:
            animation = binding.animation
            for variant in profile.intensity_variants.get(emotion, []):
                if intensity <= variant.max_intensity:
                    animation = variant.animation
                    break
        if animation not in profile.animations:  # defensive; repository already validated
            animation = binding.animation

        reaction = None
        raw_reaction = normalize_id(beat.reaction)
        if raw_reaction:
            target = profile.reaction_aliases.get(raw_reaction, raw_reaction)
            if target in profile.reactions:
                reaction = target
        if reaction is None and binding.reaction:
            reaction = binding.reaction  # the emotion itself implies a reaction (e.g. surprised)

        explicit_sfx = profile.sfx.reactions.get(raw_reaction or "")
        explicit_reaction = bool(raw_reaction and (
            profile.reaction_aliases.get(raw_reaction, raw_reaction) in profile.reactions or explicit_sfx
        ))
        if raw_reaction and not explicit_reaction:
            notes.append(f"beat {i}: unknown reaction '{raw_reaction}' ignored")
        return _Resolved(beat, emotion, animation, intensity, reaction, gesture,
                         explicit_sfx, raw_reaction)

    # ---- merging / pose holding ------------------------------------------------------------

    def _estimate_ms(self, text: str, profile: CharacterProfile) -> int:
        return SEGMENT_BASE_MS + len(text) * profile.director.ms_per_char

    def _merge(
        self, resolved: list[_Resolved], profile: CharacterProfile, hold_scale: float, notes: list[str]
    ) -> list[Segment]:
        cfg = profile.director
        min_hold = cfg.min_pose_hold_ms * hold_scale
        segments: list[Segment] = []
        for i, r in enumerate(resolved):
            text = r.beat.text.strip()
            if segments:
                prev = segments[-1]
                same_pose = r.emotion == prev.emotion and r.animation == prev.animation
                if same_pose and r.reaction is None and r.explicit_sfx is None:
                    prev.text = f"{prev.text} {text}"
                    prev.intensity = max(prev.intensity, r.intensity)
                    prev.estimated_ms = self._estimate_ms(prev.text, profile)
                    notes.append(f"beat {i}: same pose as previous beat, merged")
                    continue
                too_soon = prev.estimated_ms < min_hold
                if too_soon and r.reaction is None and r.explicit_sfx is None and r.intensity < cfg.strong_change_intensity:
                    notes.append(
                        f"beat {i}: pose change to '{r.animation}' suppressed "
                        f"(previous pose held only ~{prev.estimated_ms}ms < {int(min_hold)}ms)"
                    )
                    segments.append(
                        Segment(text, prev.emotion, prev.animation, r.intensity, None, None, self._estimate_ms(text, profile))
                    )
                    continue
            segments.append(
                Segment(text, r.emotion, r.animation, r.intensity, r.reaction, r.gesture,
                        self._estimate_ms(text, profile), explicit_sfx=r.explicit_sfx,
                        reaction_intent=r.reaction_intent)
            )
        return segments

    # ---- reactions -----------------------------------------------------------------------

    def _apply_reactions(
        self,
        segments: list[Segment],
        profile: CharacterProfile,
        state: DirectorState,
        now_ms: float,
        notes: list[str],
    ) -> DirectorState:
        cfg = profile.director
        threshold = min(1.0, max(0.0, cfg.reaction_min_intensity + (0.5 - cfg.expressiveness) * 0.4))
        cooldown = cfg.reaction_cooldown_ms * (1.5 - cfg.expressiveness)
        last = state.last_reaction_at_ms
        used = 0
        clock = now_ms
        for i, segment in enumerate(segments):
            if segment.reaction:
                reason = None
                if segment.intensity < threshold:
                    reason = f"intensity {segment.intensity:.2f} < {threshold:.2f}"
                elif used >= cfg.max_reactions_per_reply:
                    reason = f"max {cfg.max_reactions_per_reply} reaction(s) per reply"
                elif last is not None and clock - last < cooldown:
                    reason = f"cooldown ({int(clock - last)}ms < {int(cooldown)}ms)"
                if reason:
                    notes.append(f"segment {i}: reaction '{segment.reaction}' suppressed: {reason}")
                    segment.reaction = None
                else:
                    used += 1
                    last = clock
            clock += segment.estimated_ms
        return DirectorState(last_reaction_at_ms=last, turn=state.turn, signature_last_turn=state.signature_last_turn,
                             sfx_last_turn=state.sfx_last_turn, last_fallback_turn=state.last_fallback_turn,
                             last_sfx_turn=state.last_sfx_turn)

    # ---- semantic reaction sounds ------------------------------------------------------------

    def _signature_for(
        self,
        segment: Segment,
        profile: CharacterProfile,
        turn: int,
        last_turn: dict[str, int],
        used_this_reply: dict[str, int],
        index: int,
        notes: list[str],
    ) -> str | None:
        """The character's own sound for this beat, if eligible and out of cooldown."""
        for sig in profile.sfx.signature:
            # Triggers: the reaction the model asked for, the visual one-shot that survived the
            # reaction rules (so the sound can sync with it), or the beat's emotion.
            by_reaction = segment.reaction_intent in sig.reactions or segment.reaction in sig.reactions
            by_emotion = segment.emotion in sig.emotions
            if not (by_reaction or by_emotion):
                continue
            # Asking for the performed reaction itself (e.g. "whip") is the strongest match: only the
            # cooldown and per-reply cap apply. Otherwise the lowest applicable threshold applies.
            intent = segment.reaction_intent
            asked = bool(sig.performs and intent and profile.reaction_aliases.get(intent, intent) == sig.performs)
            levels = ([sig.min_intensity] if by_reaction else []) + (
                [sig.emotion_min_intensities.get(segment.emotion, sig.min_intensity)] if by_emotion else [])
            threshold = 0.0 if asked else min(levels)
            if segment.intensity < threshold:
                notes.append(f"segment {index}: signature '{sig.id}' skipped: "
                             f"intensity {segment.intensity:.2f} < {threshold:.2f}")
                continue
            if used_this_reply.get(sig.id, 0) >= sig.max_per_reply:
                notes.append(f"segment {index}: signature '{sig.id}' skipped: max {sig.max_per_reply} per reply")
                continue
            last = last_turn.get(sig.id)
            if last is not None and turn - last - 1 < sig.cooldown_turns:
                notes.append(f"segment {index}: signature '{sig.id}' on cooldown "
                             f"({turn - last - 1} < {sig.cooldown_turns} silent replies)")
                continue
            used_this_reply[sig.id] = used_this_reply.get(sig.id, 0) + 1
            last_turn[sig.id] = turn
            return sig.id
        return None

    def _apply_sfx(
        self,
        segments: list[Segment],
        profile: CharacterProfile,
        notes: list[str],
        turn: int = 1,
        signature_last_turn: dict[str, int] | None = None,
        sounds: DirectorState | None = None,
    ) -> None:
        """Resolve each beat's sound: signature override (if eligible) -> semantic reaction ->
        conservative emotion fallback -> none. `signature_last_turn` and `sounds` (category /
        fallback / any-sound turns) are updated in place; `signature_last_turn=None` disables
        signatures and every reaction a signature performs."""
        cfg = profile.sfx
        sounds = sounds if sounds is not None else DirectorState()
        used = 0
        realization_used = False
        signature_used: dict[str, int] = {}
        owned = {sig.performs: sig.id for sig in cfg.signature if sig.performs}

        def label(segment: Segment) -> str:
            return (f"emotion={segment.emotion}, intensity={segment.intensity:.2f}, "
                    f"reaction={segment.reaction_intent or 'none'}")

        def category_cooling(name: str) -> int | None:
            """Silent replies since `name` last played, while that is still within its cooldown."""
            last = sounds.sfx_last_turn.get(name)
            if last is None or last == turn:
                return None
            silent = turn - last - 1
            return silent if silent < cfg.category_cooldown_turns else None

        def play(segment: Segment, name: str) -> None:
            segment.sfx = name
            sounds.sfx_last_turn[name] = turn
            sounds.last_sfx_turn = turn

        for i, segment in enumerate(segments):
            if signature_last_turn is not None and cfg.signature:
                signature = self._signature_for(segment, profile, turn, signature_last_turn, signature_used, i, notes)
                if signature:
                    sig = next(s for s in cfg.signature if s.id == signature)
                    sounds.last_sfx_turn = turn
                    if sig.performs:
                        # The reaction's own effect cues carry the sounds, in sync with its frames.
                        segment.reaction = sig.performs
                        segment.sfx = None
                        notes.append(f"segment {i}: {label(segment)}, signature '{signature}' performed as reaction "
                                     f"'{sig.performs}' (sounds from its effect cues)")
                    else:
                        segment.sfx = signature
                        notes.append(f"segment {i}: {label(segment)}, SFX={signature} (signature)")
                    continue
            if segment.reaction in owned:
                notes.append(f"segment {i}: reaction '{segment.reaction}' dropped: signature "
                             f"'{owned[segment.reaction]}' not eligible (never a partial effect)")
                segment.reaction = None
            name = segment.explicit_sfx
            if name:
                if name == "realization" and realization_used:
                    notes.append(f"segment {i}: SFX 'realization' suppressed: max 1 realization per reply")
                    continue
                # An explicit request is a strong semantic match: only the realization cap applies.
                play(segment, name)
                realization_used = realization_used or name == "realization"
                notes.append(f"segment {i}: {label(segment)}, SFX={name} (explicit reaction '{segment.reaction_intent}')")
                continue
            threshold = cfg.emotion_min_intensities.get(segment.emotion, cfg.min_intensity)
            quiet = turn - (sounds.last_sfx_turn or 0) - 1
            drought = bool(cfg.drought_turns) and sounds.last_sfx_turn != turn and quiet >= cfg.drought_turns
            if drought:
                threshold = max(0.0, threshold - cfg.drought_bonus)
            if segment.intensity >= threshold:
                name = cfg.emotions.get(segment.emotion)
            if name:
                reason = None
                last_fallback = sounds.last_fallback_turn
                silent = category_cooling(name)
                if used >= cfg.max_per_reply:
                    reason = f"max {cfg.max_per_reply} per reply"
                elif (last_fallback is not None and last_fallback != turn
                      and turn - last_fallback - 1 < cfg.fallback_cooldown_turns):
                    reason = f"fallback cooldown ({turn - last_fallback - 1} < {cfg.fallback_cooldown_turns} silent replies)"
                elif silent is not None:
                    reason = f"category cooldown ({silent} < {cfg.category_cooldown_turns} silent replies)"
                if reason:
                    notes.append(f"segment {i}: SFX '{name}' suppressed: {reason}")
                else:
                    play(segment, name)
                    used += 1
                    sounds.last_fallback_turn = turn
                    how = f"emotion fallback at {threshold:.2f}" + (f", after {quiet} silent replies" if drought else "")
                    notes.append(f"segment {i}: {label(segment)}, SFX={name} ({how})")
            else:
                reason = (f"intensity {segment.intensity:.2f} < {threshold:.2f}"
                          if segment.emotion in cfg.emotions and segment.intensity < threshold
                          else f"emotion '{segment.emotion}' has no SFX mapping")
                notes.append(f"segment {i}: {label(segment)}, SFX suppressed: {reason}")

    # ---- end state -----------------------------------------------------------------------

    def _settle(
        self, reply: CharacterReply, segments: list[Segment], profile: CharacterProfile, notes: list[str]
    ) -> tuple[str, str]:
        raw = normalize_id(reply.settle_emotion)
        emotion = profile.emotion_aliases.get(raw or "", raw)
        if emotion in profile.emotions:
            if emotion == segments[-1].emotion:
                return emotion, segments[-1].animation  # keep the pose already on screen
            return emotion, profile.emotions[emotion].animation
        if reply.settle_emotion:
            notes.append(f"unknown settle emotion '{reply.settle_emotion}': staying in the last pose")
        return segments[-1].emotion, segments[-1].animation
