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
- reactions need enough intensity, are capped per reply and have a cooldown that spans replies.
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
    """Per-conversation state carried between replies (reaction cooldown)."""

    last_reaction_at_ms: float | None = None

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
    ) -> tuple[PerformanceTimeline, DirectorState]:
        state = state or DirectorState()
        notes: list[str] = []
        cfg = profile.director
        hold_scale = 1.5 - cfg.expressiveness  # expressive characters change pose sooner

        if reply is None or not reply.beats:
            emotion = profile.error_emotion or profile.fallback_emotion
            notes.append("no usable reply: using the character's error line")
            reply = CharacterReply(beats=[Beat(text=profile.error_text, emotion=emotion, intensity=0.4)])

        beats = list(reply.beats)
        if len(beats) > cfg.max_beats_per_reply:
            keep = cfg.max_beats_per_reply
            tail = " ".join(b.text for b in beats[keep - 1 :])
            notes.append(f"{len(beats)} beats > max {keep}: merged the extra beats into the last one")
            beats = beats[: keep - 1] + [beats[keep - 1].model_copy(update={"text": tail})]

        resolved = [self._resolve(beat, profile, notes, i) for i, beat in enumerate(beats)]
        segments = self._merge(resolved, profile, hold_scale, notes)
        state = self._apply_reactions(segments, profile, state, now_ms, notes)
        self._apply_sfx(segments, profile, notes)
        settle_emotion, settle_animation = self._settle(reply, segments, profile, notes)
        return PerformanceTimeline(profile.id, segments, settle_emotion, settle_animation, notes), state

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
        return DirectorState(last_reaction_at_ms=last)

    # ---- semantic reaction sounds ------------------------------------------------------------

    def _apply_sfx(
        self, segments: list[Segment], profile: CharacterProfile, notes: list[str]
    ) -> None:
        """Select explicit semantic sounds first, then conservative emotion fallbacks."""
        cfg = profile.sfx
        used = 0
        for i, segment in enumerate(segments):
            name = segment.explicit_sfx
            if name:
                segment.sfx = name
                notes.append(
                    f"segment {i}: emotion={segment.emotion}, intensity={segment.intensity:.2f}, "
                    f"reaction={segment.reaction_intent or 'none'}, SFX={name} "
                    f"(explicit reaction '{segment.reaction_intent}')"
                )
                continue
            threshold = cfg.emotion_min_intensities.get(segment.emotion, cfg.min_intensity)
            if segment.intensity >= threshold:
                name = cfg.emotions.get(segment.emotion)
            if name and used < cfg.max_per_reply:
                segment.sfx = name
                used += 1
                notes.append(
                    f"segment {i}: emotion={segment.emotion}, intensity={segment.intensity:.2f}, "
                    f"reaction={segment.reaction_intent or 'none'}, SFX={name} (emotion fallback at {threshold:.2f})"
                )
            elif name:
                notes.append(f"segment {i}: SFX '{name}' suppressed: max {cfg.max_per_reply} per reply")
            else:
                reason = (f"intensity {segment.intensity:.2f} < {threshold:.2f}"
                          if segment.emotion in cfg.emotions and segment.intensity < threshold
                          else f"emotion '{segment.emotion}' has no SFX mapping")
                notes.append(
                    f"segment {i}: emotion={segment.emotion}, intensity={segment.intensity:.2f}, "
                    f"reaction={segment.reaction_intent or 'none'}, SFX suppressed: {reason}"
                )

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
