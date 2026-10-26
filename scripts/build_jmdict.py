"""Build offline EN/verified-FR shards from the FULL official JMdict archive.

No network or third-party Python dependencies. Input checksums are mandatory.
French glosses must also occur under the same entry ID in the CC BY-SA
JMdict internationalization project's pinned fr.jmf, avoiding the older FJ data.
"""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
XML_LANG = '{http://www.w3.org/XML/1998/namespace}lang'
SOURCE = 'https://www.edrdg.org/pub/Nihongo/JMdict.gz'
FRENCH_SOURCE = 'https://raw.githubusercontent.com/Gnurou/jmdict-i18n/97c1e221b512ef3874f89580995a733ed129a44f/jmdict/jmf/fr.jmf'


def checked(path, digest):
    data = Path(path).read_bytes()
    if hashlib.sha256(data).hexdigest() != digest.lower():
        raise ValueError(f'Input checksum mismatch: {path}')
    return data


def shard_key(text):
    value = 2166136261
    for char in text:
        value = ((value ^ ord(char)) * 16777619) & 0xffffffff
    return f'{value % 256:02x}'


def texts(node, tag):
    return [child.text or '' for child in node.findall(tag)]


def safe_xml(data):
    with gzip.GzipFile(fileobj=io.BytesIO(data)) as stream:
        raw = stream.read(400_000_001)
    if len(raw) > 400_000_000:
        raise ValueError('JMdict XML exceeds preprocessing limit')
    header = raw[:raw.index(b'<JMdict>')]
    # JMdict uses simple internal POS entities. Never allow external or nested entities.
    declarations = re.findall(rb'<!ENTITY\s+([^>]+)>', header)
    for declaration in declarations:
        if not re.fullmatch(rb'[\w-]+\s+"[^&%<"]*"', declaration):
            raise ValueError('Unsafe XML entity declaration')
    if re.search(rb'<!DOCTYPE\s+\w+\s+(?:SYSTEM|PUBLIC)', header) or b'<!ENTITY' in raw[len(header):]:
        raise ValueError('External XML resources are forbidden')
    # Retain short, documented JMdict tag IDs instead of expanded prose.
    return re.sub(rb'<!ENTITY\s+([\w-]+)\s+"[^"]*">', lambda m: b'<!ENTITY '+m[1]+b' "'+m[1]+b'">', raw)


def build(args):
    source = checked(args.input, args.sha256)
    french = checked(args.french, args.french_sha256)
    verified_fr = {}
    for line in french.decode('utf-8').splitlines():
        seq, _, gloss = line.split(' ', 2)
        verified_fr.setdefault(seq, set()).add(gloss)
    raw = safe_xml(source)
    version = re.search(rb'JMdict created: ([0-9-]+)', raw)
    if not version:
        raise ValueError('Missing official snapshot date')
    shards = {f'{i:02x}': {} for i in range(256)}
    counts = dict(inputEntries=0, entries=0, frenchEntries=0, englishEntries=0, keys=0)
    root = None
    for event, node in ET.iterparse(io.BytesIO(raw), events=('start', 'end')):
        if root is None:
            root = node
        if event != 'end' or node.tag != 'entry':
            continue
        counts['inputEntries'] += 1
        seq = node.findtext('ent_seq')
        kanji = [[k.findtext('keb'), texts(k, 'ke_inf'), texts(k, 'ke_pri')] for k in node.findall('k_ele')]
        readings = [[r.findtext('reb'), texts(r, 're_restr'), r.find('re_nokanji') is not None,
                     texts(r, 're_inf'), texts(r, 're_pri')] for r in node.findall('r_ele')]
        senses, inherited_pos = [], []
        for s in node.findall('sense'):
            inherited_pos = texts(s, 'pos') or inherited_pos
            en, fr = [], []
            for gloss in s.findall('gloss'):
                lang, value = gloss.get(XML_LANG, 'eng'), gloss.text or ''
                if lang == 'eng':
                    en.append(value)
                elif lang == 'fre':
                    allowed = verified_fr.get(seq, set())
                    # Some upstream imports append a usage note, e.g. "preuve (jur.)".
                    # Emit the actual licensed translation, not that unverified annotation.
                    core = re.sub(r'\s+\([^()]*\)$', '', value)
                    if value in allowed:
                        fr.append(value)
                    elif core in allowed:
                        fr.append(core)
            if en or fr:
                senses.append([texts(s, 'stagk'), texts(s, 'stagr'), inherited_pos,
                               texts(s, 'misc'), texts(s, 'field'), texts(s, 'dial'), texts(s, 's_inf'), en, fr])
        if senses:
            counts['entries'] += 1
            counts['frenchEntries'] += any(s[8] for s in senses)
            counts['englishEntries'] += any(s[7] for s in senses)
            entry = [seq, kanji, readings, senses]
            for key in set([k[0] for k in kanji] + [r[0] for r in readings]):
                shards[shard_key(key)].setdefault(key, []).append(entry)
        node.clear()
        root.clear()
    output = Path(args.output)
    # Guard the only generated-write directory; never write into the source archive.
    if output.resolve() != (ROOT / 'frontend/public/assets/jmdict').resolve():
        raise ValueError('Output must be frontend/public/assets/jmdict')
    output.mkdir(parents=True, exist_ok=True)
    files = {}
    for key, index in shards.items():
        counts['keys'] += len(index)
        data = json.dumps(index, ensure_ascii=False, separators=(',', ':'), sort_keys=True).encode()
        compressed = gzip.compress(data, compresslevel=9, mtime=0)
        name = f'{key}.json.gz.bin'  # raw gzip bytes: servers must not auto-decompress these assets
        (output / name).write_bytes(compressed)
        files[name] = dict(bytes=len(compressed), expandedBytes=len(data), sha256=hashlib.sha256(compressed).hexdigest())
    manifest = dict(schemaVersion=1, snapshot=version[1].decode(), downloadedOn=args.downloaded_on,
                    source=SOURCE, sourceSha256=args.sha256.lower(), frenchSource=FRENCH_SOURCE,
                    frenchSha256=args.french_sha256.lower(), license='CC-BY-SA-4.0',
                    frenchOriginalLicense='CC-BY-SA-3.0', counts=counts, files=files)
    (output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(dict(**counts, compressedBytes=sum(f['bytes'] for f in files.values()),
                          expandedBytes=sum(f['expandedBytes'] for f in files.values())), indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--french', required=True)
    parser.add_argument('--french-sha256', required=True)
    parser.add_argument('--downloaded-on', required=True)
    parser.add_argument('--output', default=str(ROOT / 'frontend/public/assets/jmdict'))
    build(parser.parse_args())
