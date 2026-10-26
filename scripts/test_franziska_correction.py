"""Focused source-to-runtime checks; run with the backend virtualenv Python."""
import json
from pathlib import Path
import unittest
import wave

import numpy as np
from PIL import Image

from correct_franziska_assets import ARCHIVE, AUDIO, PACK, ROOT, NATIVE_IDS, NATIVE_OFFSETS, DURATIONS


class FranziskaCorrectionTests(unittest.TestCase):
    def test_native_stage_registration_and_transparency(self):
        manifest = json.loads((PACK / 'character.json').read_text(encoding='utf-8'))
        clip = manifest['reactions']['whip_crack']
        self.assertEqual(clip['canvas'], {'width': 256, 'height': 192})
        self.assertFalse(clip['loop'])
        self.assertEqual(clip['frameDurations'], DURATIONS)
        self.assertEqual(sum(DURATIONS), 1500)
        for path, native_id, (x, y) in zip(clip['frames'], NATIVE_IDS, NATIVE_OFFSETS):
            actual = Image.open(PACK / path).convert('RGBA')
            expected = Image.new('RGBA', (256, 192))
            original = Image.open(PACK / f'sprites/whip_crack/reaction/franziska_frame_{native_id:03d}.png').convert('RGBA')
            expected.alpha_composite(original, (x - 44, y + 59))
            np.testing.assert_array_equal(np.array(actual), np.array(expected))
            self.assertEqual(actual.size, (256, 192))
            alpha = np.array(actual)[:, :, 3]
            self.assertEqual(set(np.unique(alpha)), {0, 255})
            self.assertTrue(np.all(alpha[:59] == 0), 'No black/full-stage substrate')

    def test_record_portrait_exact_native_source(self):
        source = Image.open(ARCHIVE / 'other assets/evidences/DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All - Miscellaneous - Evidence.png').convert('RGBA')
        actual = Image.open(PACK / 'portraits/court_record.png').convert('RGBA')
        self.assertEqual(actual.size, (64, 64))
        np.testing.assert_array_equal(np.array(actual), np.array(source.crop((643, 75, 707, 139))))

    def test_selection_centered_without_resampling(self):
        manifest = json.loads((PACK / 'character.json').read_text(encoding='utf-8'))
        actual = Image.open(PACK / manifest['selectionPreview']).convert('RGBA')
        self.assertEqual(actual.size, (170, 170))
        self.assertEqual(actual.getbbox(), (21, 0, 149, 170))
        native = Image.open(PACK / 'conversation/AA_Franziska_von_Karma_Normal_Forward_1/frame_000.png').convert('RGBA')
        np.testing.assert_array_equal(np.array(actual.crop((21, 0, 149, 170))), np.array(native.crop((78, 22, 206, 192))))

    def test_whip_then_whack_matches_strike_and_preserves_semantic_event(self):
        manifest = json.loads((AUDIO / 'audio.json').read_text(encoding='utf-8'))
        # D-091: the whip now sounds through the reaction's effect cues (whip_swing -> whip_impact);
        # the compound file is retained as a registered sound, no longer a semantic event.
        self.assertNotIn('sfx_whip', manifest['events'])
        self.assertEqual(manifest['sounds']['fx_whip']['src'], 'effects/whip_crack.wav')
        with wave.open(str(AUDIO / 'effects/whip_crack.wav'), 'rb') as sound:
            self.assertEqual((sound.getnchannels(), sound.getsampwidth(), sound.getframerate()), (1, 2, 22050))
            combined = np.frombuffer(sound.readframes(sound.getnframes()), dtype='<i2')
        with wave.open(str(ROOT / 'docs/sfx general/sfx-whip.wav'), 'rb') as sound:
            whip = np.frombuffer(sound.readframes(sound.getnframes()), dtype='<i2')
        np.testing.assert_array_equal(combined[:len(whip)], whip)
        impact_sample = round(22050 * sum(DURATIONS[:4]) / 1000)
        self.assertEqual(impact_sample, 8820)
        self.assertTrue(np.all(combined[len(whip):impact_sample] == 0))
        self.assertTrue(np.any(combined[impact_sample:] != 0))
        performance = json.loads((PACK / 'performance.json').read_text(encoding='utf-8'))
        signature = next(item for item in performance['sfx']['signature'] if item['id'] == 'whip')
        self.assertEqual(signature['cooldownTurns'], 3)  # D-094: the whip is part of her repertoire
        self.assertEqual(signature['maxPerReply'], 1)


if __name__ == '__main__':
    unittest.main()
