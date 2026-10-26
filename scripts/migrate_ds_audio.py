#!/usr/bin/env python3
"""Selective, auditable DS soundtrack migration; source files are read-only.

Run with --source-root <game_soundtrack> --ffmpeg <exe> [--write]. Only the
explicit title/game mappings below are eligible. Baselines are captured once,
before mutation; a repeat run verifies KEEP/REVIEW entries before proceeding.
WAV renders become lossless native-rate FLAC; original DS MP3s copy unchanged.
Loop analysis is deliberately separate: analyse_loops.py --ids <replaced IDs>.
After analysis, run --finalize-analysis scripts/data/ds_loop_analysis.json --write.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MUSIC = ROOT / 'frontend/public/assets/music'
MANIFEST = MUSIC / 'soundtrack.json'
AUDIT = ROOT / 'scripts/data/ds_audio_migration.json'

# Explicit semantic mapping, by established manifest ID and original DS filename.
# Different English localizations are intentional; numbering alone is never used.
JFA = {
 'defendant_lobby_so_it_begins_again': "03 Courtroom Lounge ~ Overture Again [BGM077].mp3",
 'justice_for_all_court_is_now_in_session': "04 Trial [BGM069].mp3",
 'cross_examination_moderato_2002': "05 Examination ~ Moderate 2002 [BGM072].mp3",
 'magic_and_tricks': "06 Trick and Magic [BGM071].mp3",
 'objection_2002': "07 Phoenix Wright ~ Objection! 2002 [BGM070].mp3",
 'cross_examination_allegro_2002': "08 Examination ~ Allegro 2002 [BGM073].mp3",
 'pursuit_confront_the_culprit': "09 Pursuit ~ Cornered [BGM074].mp3",
 'the_truth_revealed_2002': "10 Announce the Truth 2002 [BGM078].mp3",
 'pursuit_confront_the_culprit_variation': "11 Pursuit ~ Cornered (Variation) [BGM075].mp3",
 'psyche_locks': "13 Psyche Lock [BGM085].mp3",
 'initial_investigation_2002': "14 Search ~ Opening 2002 [BGM065].mp3",
 'maya_fey_turnabout_sisters_2002': "15 Maya Fey ~ Turnabout Sisters' Theme 2002 [BGM054].mp3",
 'detention_center_the_security_cameras_elegy': "16 Police Cell ~ Elegy of Surveillance Cameras [BGM058].mp3",
 'kurain_village': "17 Kurain Village [BGM057].mp3",
 'reminiscences_fire_licked_scars': "18 Reminiscence ~ Scars Etched by Flame [BGM062].mp3",
 'eccentrics': "19 Eccentric [BGM059].mp3",
 'berry_big_circus': "21 Tachimi - Circus [BGM055].mp3",
 'more_simple_folk': "22 Congratulations Everybody, Again [BGM068].mp3",
 'reminiscences_pure_pain': "23 Reminiscence ~ True Pain [BGM063].mp3",
 'shelly_de_killer_a_deadly_gentlemans_delight': "24 Shelly de Killer ~ The Whim of a Murderous Gentleman [BGM061].mp3",
 'pearl_fey_with_pearly': "25 Pearl Fey ~ With Pearly [BGM092].mp3",
 'further_investigation_2002': "26 Search ~ In the Midst 2002 [BGM088].mp3",
 'triumphant_return_miles_edgeworth': "27 Great Revival ~ Miles Edgeworth [BGM067].mp3",
 'hotline_of_fate': "28 Hotline of Fate [BGM086].mp3",
 'heart_of_the_investigation_2002': "29 Search ~ Core 2002 [BGM064].mp3",
 'reminiscences_ballad_of_the_steel_samurai': "30 Reminiscence ~ Steel Samurai's Ballad [BGM053].mp3",
 'triumphant_return_franziska_von_karma': "31 Great Revival ~ Franziska von Karma [BGM087].mp3",
 'one_prosecutors_musings_until_we_meet_again': "35 Prosecutor's Murmur ~ Until we Meet Again [BGM089].mp3",
}
TNT = {
 'defendant_lobby_so_it_will_always_begin': "03 Courtroom Lounge ~ Neverending Overture.wav",
 'trials_and_tribulations_court_is_now_in_session': "04 Trial.wav",
 'cross_examination_moderato_2004': "05 Questioning ~ Moderate 2004.wav",
 'objection_2004': "06 Phoenix Wright ~ Objection! 2004.wav",
 'cross_examination_allegro_2004': "07 Questioning ~ Allegro 2004.wav",
 'pursuit_catch_the_culprit': "08 Pressing Pursuit ~ Cross-Examination.wav",
 'the_truth_revealed_2004': "09 Telling the Truth 2004.wav",
 'pursuit_catch_the_culprit_variation': "10 Pressing Pursuit ~ Cross-Examination Variation.wav",
 'dahlia_hawthorne_the_visage_of_what_once_was': "11 Dahlia Hawthorne ~ Distant Trace.wav",
 'godot_the_fragrance_of_darkness_that_is_coffee': "12 Godot ~ The Fragrance of Dark-Colored Coffee.wav",
 'initial_investigation_2004': "14 Investigation ~ Opening 2004.wav",
 'lordly_tailor': "17 Lordly Tailor Department Store.wav",
 'detention_center_the_prisoners_elegy': "18 Detention Center ~ Elegy of the Captured.wav",
 'mask_demasque_please_listen_to_meeeee': "19 Mask De Masque ~ Please Listen!.wav",
 'luke_atmey_look_at_me': "20 Luke Atmey ~ I Just Want Love.wav",
 'larry_butz_when_something_smells_its_usually_me': "21 Larry Butz ~ Still in the Shadow of the Incident.wav",
 'tres_bien': "22 Beauty Hermitage.wav",
 'victor_kudo_martial_anthem_of_misery': "23 Victor Kudo ~ War Song Must Inspect.wav",
 'furio_tigre_swingin_tiger': "24 Furio Tigre ~ Swingin' Tiger.wav",
 'reminiscences_violetta_vitriol': "25 Recollection ~ What the Others Have Seen.wav",
 'turnabout_beginnings': "26 Case 4 - ''Turnabout Beginnings''.wav",
 'reminiscences_the_view_from_dusky_bridge': "27 Recollection ~ Scenery Where the Hazy Bridge is Seen.wav",
 'hazakura_temple': "29 Hazakurain.wav",
 'elise_deauxnim_a_gentle_melody': "30 Elise Deauxnim ~ Simple Melody.wav",
 'further_investigation_2004': "31 Investigation ~ Middle Stage 2004.wav",
 'reminiscences_the_bitterness_of_truth': "32 Recollection ~ The Bitter Taste of Truth.wav",
 'pursuit_corner_the_culprit_2004': "33 Pressing Pursuit ~ Cornered 2004.wav",
}
REVIEW = {
 'bonus_prosecutors_path_miles_and_fran': 'Bonus arrangement not present in original JFA source set.',
 'the_stolen_turnabout': 'DS has two separately rendered opening parts; OST correspondence/arrangement needs listening.',
 'recipe_for_turnabout': 'No confidently labelled corresponding DS render; unknown source files are not guessed.',
 'pursuit_corner_the_culprit_2004_variation': 'No explicitly labelled 2004 variation; 99 PW1 variation is not assumed equivalent.',
}

def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path)
    parser.add_argument('--ffmpeg')
    parser.add_argument('--finalize-analysis', type=Path)
    parser.add_argument('--verify-lossless', action='store_true', help='compare decoded PCM of WAV sources and installed FLAC derivatives; read-only')
    parser.add_argument('--archive-remasters', action='store_true', help='move only SHA-verified replaced remasters out of runtime into ignored local backup')
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
    baseline = json.loads(AUDIT.read_text(encoding='utf-8')) if AUDIT.exists() else {
        'version': 1, 'baselineCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
        'policy': 'Preserve pre-expansion runtime bytes and current metadata; only explicit expansion mappings replace defaults.',
        'sourcePolicy': 'Read-only original DS JFA MP3 set and NCSF123 native/default T&T WAV renders. No listening claimed.',
        'profilesBefore': manifest['profiles'], 'tracks': {},
    }
    head = json.loads(subprocess.check_output(['git', 'show', baseline['baselineCommit'] + ':frontend/public/assets/music/soundtrack.json']))
    if args.archive_remasters:
        backup_root = (ROOT / 'backend/.local/audio-migration/remaster-backup').resolve()
        assert backup_root.is_relative_to((ROOT / 'backend/.local').resolve())
        for key, item in baseline['tracks'].items():
            if item['action'] != 'REPLACE':
                continue
            assert manifest['tracks'][key]['src'] == item['replacement']
            assert sha(MUSIC / item['replacement']) == item['replacementSha256']
            old = (MUSIC / item['before']['src']).resolve()
            assert old.is_relative_to((MUSIC / 'original').resolve())
            target = backup_root / old.name
            assert target.parent == backup_root
            if old.exists():
                assert sha(old) == item['beforeSha256'], f'{key}: old file changed; refusing to move'
                assert not target.exists(), f'{key}: backup already exists; refusing overwrite'
                if args.write:
                    backup_root.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(old), str(target))
            elif target.exists():
                assert sha(target) == item['beforeSha256'], f'{key}: backup differs'
            else:
                raise AssertionError(f'{key}: neither original nor backup exists')
            item['archivedRemaster'] = target.relative_to(ROOT).as_posix()
        if args.write:
            write_json(AUDIT, baseline)
        print('55 SHA-verified replaced remasters archived outside runtime; no KEEP/REVIEW files moved')
        return
    if args.finalize_analysis:
        report = json.loads(args.finalize_analysis.read_text(encoding='utf-8'))
        replaced = {key for key, item in baseline['tracks'].items() if item['action'] == 'REPLACE'}
        assert set(report) == replaced, 'Analysis must cover exactly the replacements'
        assert manifest['profiles'] == baseline['profilesBefore'], 'Character themes changed'
        for key, item in baseline['tracks'].items():
            entry = manifest['tracks'][key]
            if item['action'] != 'REPLACE':
                assert entry == item['before'], f'{key}: untouched metadata changed'
                assert sha(MUSIC / entry['src']) == item['beforeSha256'], f'{key}: untouched audio changed'
                continue
            assert entry['src'] == item['replacement'], f'{key}: replacement path changed'
            assert sha(MUSIC / entry['src']) == item['replacementSha256'], f'{key}: replacement audio changed'
            measured = report[key]
            if measured.get('best'):
                assert entry['loop'] and entry['loop']['startSample'] == measured['best']['start']
                assert entry['loop']['endSample'] == measured['best']['end']
                assert measured['best']['passes'] and measured['best']['end'] / 44100 <= measured['duration']
                entry['loopStatus'] = 'measured_not_auditioned'
            else:
                assert entry['loop'] is None and entry['loopReason'] == measured['reason']
                entry['loopStatus'] = 'whole_file'
            item['loopStatus'] = entry['loopStatus']
            item['durationSeconds'] = measured['duration']
            item['auditioned'] = False
        baseline['summary'] = {
            'preserved': 25, 'expansionImports': 59, 'replaced': len(replaced), 'review': 4,
            'measured_not_auditioned': sum(manifest['tracks'][key]['loopStatus'] == 'measured_not_auditioned' for key in replaced),
            'whole_file': sum(manifest['tracks'][key]['loopStatus'] == 'whole_file' for key in replaced),
        }
        if args.write:
            write_json(MANIFEST, manifest)
            write_json(AUDIT, baseline)
        print(json.dumps(baseline['summary']))
        return
    if not args.source_root or not args.ffmpeg:
        parser.error('--source-root and --ffmpeg are required for installation')
    sources = {key: args.source_root / 'Phoenix Wright - Ace Attorney Justice for All' / name for key, name in JFA.items()}
    sources.update({key: args.source_root / 'Phoenix Wright - Ace Attorney Trials and Tribulations' / 'wav' / name for key, name in TNT.items()})
    # Validate the entire plan before creating derivatives or editing the manifest.
    for key, entry in manifest['tracks'].items():
        if not entry.get('src'):
            continue
        if key not in baseline['tracks']:
            baseline['tracks'][key] = {'before': entry.copy(), 'beforeSha256': sha(MUSIC / entry['src'])}
        item = baseline['tracks'][key]
        action = 'KEEP' if key in head['tracks'] else 'REPLACE' if key in sources else 'REVIEW'
        item['action'] = action
        item['confidence'] = 'high' if action != 'REVIEW' else 'uncertain'
        if action != 'REPLACE':
            assert entry == item['before'], f'{key}: untouched metadata changed'
            assert sha(MUSIC / entry['src']) == item['beforeSha256'], f'{key}: untouched bytes changed'
            item['reason'] = 'Pre-expansion valid runtime track; entire entry and audio preserved.' if action == 'KEEP' else REVIEW[key]
            continue
        source = sources[key]
        assert source.is_file(), f'Missing source: {source}'
        assert entry.get('disc') == (2 if key in JFA else 3), f'{key}: game mismatch'
        item['source'] = source.relative_to(args.source_root).as_posix()
        source_hash = sha(source)
        assert not item.get('sourceSha256') or item['sourceSha256'] == source_hash, f'{key}: source changed since audit'
        item['sourceSha256'] = source_hash
        item['reason'] = 'Explicit same-game title/localization mapping; not fuzzy matching.'
        suffix = '.mp3' if source.suffix.lower() == '.mp3' else '.flac'
        item['replacement'] = 'original/ds-' + key.replace('_', '-') + suffix
    if args.verify_lossless:
        verified = 0
        for key in TNT:
            def pcm_digest(path: Path) -> bytes:
                return subprocess.check_output([args.ffmpeg, '-v', 'error', '-i', str(path), '-map', '0:a:0', '-c:a', 'pcm_s16le', '-f', 'md5', '-'])
            assert pcm_digest(sources[key]) == pcm_digest(MUSIC / baseline['tracks'][key]['replacement']), f'{key}: PCM differs'
            verified += 1
        print(f'{verified} FLAC derivatives have sample-identical native-rate PCM to their WAV sources')
        return
    if not args.write:
        print(json.dumps({a: sum(t['action'] == a for t in baseline['tracks'].values()) for a in ['KEEP','REPLACE','REVIEW']}))
        return
    write_json(AUDIT, baseline)  # capture immutable pre-migration evidence before first write
    for key, item in baseline['tracks'].items():
        if item['action'] != 'REPLACE':
            continue
        entry = manifest['tracks'][key]
        source, target = sources[key], MUSIC / item['replacement']
        if entry['src'] == item['replacement'] and target.exists() and item.get('replacementSha256') == sha(target):
            continue  # Idempotent: retain already measured DS loops and existing bytes.
        if source.suffix.lower() == '.mp3':
            shutil.copyfile(source, target)
        else:
            subprocess.run([args.ffmpeg, '-v', 'error', '-y', '-i', str(source), '-map_metadata', '-1', '-c:a', 'flac', '-compression_level', '8', str(target)], check=True)
        item['replacementSha256'] = sha(target)
        # Never reuse remaster loop points, loudness measurement or gain.
        entry['src'] = item['replacement']
        entry['gain'] = 1
        entry.pop('loudnessLufs', None)
        entry['loop'] = None
        entry['loopReason'] = 'DS replacement: loop unmeasured; whole-file fallback until scoped analysis. Not auditioned.'
        entry['audioProvenance'] = 'original-ds-mp3' if key in JFA else 'original-ds-ncsf123-lossless'
        entry['loopStatus'] = 'unmeasured'
    write_json(MANIFEST, manifest)
    write_json(AUDIT, baseline)
    print('Replaced:', sum(t['action'] == 'REPLACE' for t in baseline['tracks'].values()))

if __name__ == '__main__':
    main()
