#!/usr/bin/env python3
"""Targeted, repeatable Franziska correction; never writes to the supplied archive.

Run with backend/.venv/Scripts/python.exe scripts/correct_franziska_assets.py.
Keeps all previous native frames and presentation groups. The supplied whip GIF is
HD effect art with 20 zero-delay frames, so it supplies no authoritative duration.
The native DS single-strike animation is deliberately paced to 1500ms instead.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import wave

import numpy as np
from PIL import Image
from scipy.signal import resample_poly

ROOT = Path(__file__).resolve().parents[1]
# Source archive: the repository's read-only `assets/` copy when present, else the original folder.
ARCHIVE = ROOT / 'assets' if (ROOT / 'assets').is_dir() else Path('C:/Users/adria/Desktop/extract_assets_ace')
PACK = ROOT / 'frontend/public/assets/characters/franziska'
AUDIO = ROOT / 'frontend/public/assets/audio'
NATIVE_IDS = [20, 21, 22, 23, 24, 26, 27, 28]
NATIVE_OFFSETS = [(86, 2), (116, 2), (100, 2), (48, 3), (116, 0), (119, 0), (82, 3), (113, 3)]
DURATIONS = [100, 100, 100, 100, 250, 200, 200, 450]
IMPACT_MS = sum(DURATIONS[:4])


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def main() -> None:
    destination = PACK / 'sprites/whip_crack/timed'
    destination.mkdir(parents=True, exist_ok=True)
    files = []
    for i, (native_id, (x, y)) in enumerate(zip(NATIVE_IDS, NATIVE_OFFSETS)):
        original = Image.open(PACK / f'sprites/whip_crack/reaction/franziska_frame_{native_id:03d}.png').convert('RGBA')
        frame = Image.new('RGBA', (256, 192))
        # Same native registration as the old bottom-centred 344x133 canvas,
        # explicitly clipped to the DS stage. No scaling, keying or recolouring.
        frame.alpha_composite(original, (x - 44, y + 59))
        name = f'sprites/whip_crack/timed/frame_{i:03d}.png'
        frame.save(PACK / name)
        files.append(name)

    # The discussion frame carries 78px of left padding and a 22px top margin.
    # Crop/pad to a square around the opaque native body, with no resampling.
    preview = Image.open(PACK / 'conversation/AA_Franziska_von_Karma_Normal_Forward_1/frame_000.png').convert('RGBA')
    bounds = preview.getbbox()
    assert bounds == (78, 22, 206, 192), bounds
    selection = Image.new('RGBA', (170, 170))
    selection.alpha_composite(preview.crop(bounds), (21, 0))
    selection.save(PACK / 'portraits/selection.png')

    evidence = ARCHIVE / 'other assets/evidences/DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All - Miscellaneous - Evidence.png'
    portrait = Image.open(evidence).convert('RGBA').crop((643, 75, 707, 139))
    portrait.save(PACK / 'portraits/court_record.png')

    manifest_path = PACK / 'character.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    manifest['selectionPreview'] = 'portraits/selection.png'
    preserved = [f'sprites/whip_crack/reaction/franziska_frame_{native_id:03d}.png' for native_id in NATIVE_IDS]
    manifest['unassignedFrames'] = list(dict.fromkeys([*manifest.get('unassignedFrames', []), *preserved]))
    manifest['reactions']['whip_crack'] = {
        'canvas': {'width': 256, 'height': 192},
        'fps': 10, 'loop': False, 'frameDurations': DURATIONS,
        'frames': files,
    }
    write_json(manifest_path, manifest)

    # One semantic event and one buffer retain the existing reply/turn cooldowns.
    # Resample only the whack to the whip's 22050Hz rate, retaining its duration.
    paths = [ROOT / 'docs/sfx general' / f'sfx-{name}.wav' for name in ['whip', 'whack']]
    samples = []
    gains = []
    rate = 22050
    for path in paths:
        with wave.open(str(path), 'rb') as sound:
            assert sound.getnchannels() == 1 and sound.getsampwidth() == 2
            audio = np.frombuffer(sound.readframes(sound.getnframes()), dtype='<i2').astype(np.float64)
            source_rate = sound.getframerate()
        if source_rate != rate:
            divisor = math.gcd(rate, source_rate)
            audio = resample_poly(audio, rate // divisor, source_rate // divisor)
        # Native whack reaches full-scale; bandlimited conversion can overshoot.
        # Apply uniform gain before quantization rather than clipping transients.
        peak = float(np.max(np.abs(audio)))
        gain = 32760 / peak if peak > 32767 else 1.0
        audio *= gain
        gains.append(gain)
        samples.append(audio)
    offset = round(rate * IMPACT_MS / 1000)
    mixed = np.zeros(max(len(samples[0]), offset + len(samples[1])))
    mixed[:len(samples[0])] += samples[0]
    mixed[offset:offset + len(samples[1])] += samples[1]
    assert mixed.min() >= -32768 and mixed.max() <= 32767, 'Unexpected clipping'
    with wave.open(str(AUDIO / 'effects/whip_crack.wav'), 'wb') as sound:
        sound.setnchannels(1)
        sound.setsampwidth(2)
        sound.setframerate(rate)
        sound.writeframes(np.rint(mixed).astype('<i2').tobytes())
    audio_path = AUDIO / 'audio.json'
    audio_manifest = json.loads(audio_path.read_text(encoding='utf-8'))
    audio_manifest['sounds']['fx_whip']['src'] = 'effects/whip_crack.wav'
    audio_manifest['sounds']['fx_whip_swing'] = {'category': 'effect', 'src': 'effects/whip.wav'}
    write_json(audio_path, audio_manifest)

    gif = ARCHIVE / 'other assets/effects/whip effect gif.gif'
    write_json(PACK / 'sprites/whip_crack/timed/source.json', {
        'method': 'native RGBA frames composed 1:1 onto transparent DS stage; existing originals retained',
        'nativeFrameIds': NATIVE_IDS,
        'nativeCanvas': [344, 133], 'nativeOffsets': NATIVE_OFFSETS,
        'nativeToStageOffset': [-44, 59],
        'frameDurationsMs': DURATIONS, 'totalDurationMs': sum(DURATIONS),
        'timingNote': 'Deliberate single-strike timing; supplied 400x240 HD GIF has 20 zero-delay frames and two swipes. No exact source timing is claimed; HD black-background effect is not used.',
        'inspectedGifSha256': sha(gif),
        'portraitSource': str(evidence.relative_to(ARCHIVE)).replace('\\', '/'),
        'portraitSourceSha256': sha(evidence), 'portraitCrop': [643, 75, 707, 139],
        'selectionSource': 'conversation/AA_Franziska_von_Karma_Normal_Forward_1/frame_000.png',
        'selectionCrop': list(bounds), 'selectionOffset': [21, 0],
        'audio': {'sourceFiles': [path.relative_to(ROOT).as_posix() for path in paths],
                  'sourceSha256': [sha(path) for path in paths], 'sampleRate': rate,
                  'sourceGains': gains,
                  'whipStartMs': 0, 'whackStartMs': IMPACT_MS, 'whackStartSample': offset,
                  'humanListening': False},
    })
    print(f'Corrected 8 native DS frames, {sum(DURATIONS)}ms, impact {IMPACT_MS}ms; selection and record portraits.')


if __name__ == '__main__':
    main()
