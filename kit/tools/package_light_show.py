#!/usr/bin/env python3
"""Package the already built Light Show as an SDK-free MGU Store USB catalog.

Run build.py light_show and test_light_show.js first. No network access.
"""
from pathlib import Path
import gzip
import hashlib
import io
import json
import shutil
import tarfile
import zipfile

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / 'apps' / 'light_show'
STAGE = ROOT / 'dist' / 'light_show' / 'source'
SPEC = json.loads((APP / 'app.json').read_text())
VERSION = SPEC['version']
OUT = ROOT / 'dist' / 'light-show-usb'
REPO = OUT / 'mgu-repo' / 'light_show'
PACKAGE_NAME = 'light_show@%s.tgz' % VERSION


def main():
    if not (STAGE / 'javascript' / 'app.js').is_file():
        raise SystemExit('Run python3 kit/tools/build.py light_show first')
    stage_spec = json.loads((STAGE / 'javascript' / 'kit' / 'app-spec.json').read_text())
    if stage_spec['version'] != VERSION:
        raise SystemExit('Stage version is stale; rebuild light_show')
    if OUT.exists():
        shutil.rmtree(OUT)
    REPO.mkdir(parents=True)
    package = json.loads((STAGE / 'package.json').read_text())
    package['mguHmi'] = ['ID7']
    package['requires'] = {'mgu-deploy': '0.7.0'}
    package['private'] = True
    data = io.BytesIO()
    with gzip.GzipFile(fileobj=data, mode='wb', filename='', mtime=0) as gz:
        with tarfile.open(fileobj=gz, mode='w') as tar:
            for p in sorted(STAGE.rglob('*')):
                rel = p.relative_to(STAGE)
                if not p.is_file() or rel.parts[:2] == ('node_modules', 'oap-sdk'):
                    continue
                raw = (json.dumps(package, indent=2) + '\n').encode() if rel.as_posix() == 'package.json' else p.read_bytes()
                info = tarfile.TarInfo('package/' + rel.as_posix())
                info.size = len(raw)
                info.mtime = 0
                info.mode = 0o644
                tar.addfile(info, io.BytesIO(raw))
    artifact = data.getvalue()
    (REPO / PACKAGE_NAME).write_bytes(artifact)
    icon = STAGE / 'rhmiData' / 'variantGroups' / 'Common' / 'images' / 'light_show.png'
    if not icon.is_file():
        icons = sorted((STAGE / 'rhmiData').rglob('*.png'))
        if not icons:
            raise SystemExit('No app icon in stage')
        icon = icons[0]
    shutil.copyfile(icon, REPO / 'icon.png')
    catalog = {'schema': 2, 'components': [{
        'id': SPEC['id'], 'kind': 'app', 'title': SPEC['title'], 'version': VERSION,
        'description': SPEC['description'], 'author': 'custom', 'mguHmi': ['ID7'],
        'uninstallable': True, 'requires': {'mgu-deploy': '0.7.0'},
        'icon': 'icon.png', 'iconSha256': hashlib.sha256((REPO / 'icon.png').read_bytes()).hexdigest(),
        'artifact': {'name': PACKAGE_NAME, 'url': PACKAGE_NAME, 'size': len(artifact), 'sha256': hashlib.sha256(artifact).hexdigest()},
    }]}
    (REPO / 'catalog.json').write_text(json.dumps(catalog, indent=2) + '\n')
    shutil.copyfile(APP / 'README.md', OUT / 'README.md')
    source = OUT / 'source'
    shutil.copytree(APP, source / 'apps' / 'light_show')
    for file in ['test_light_show.js', 'package_light_show.py']:
        dst = source / 'kit' / 'tools' / file
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / 'kit' / 'tools' / file, dst)
    shutil.copyfile(ROOT / 'LICENSE', OUT / 'LICENSE-idrive7-apps.txt')
    (OUT / 'SOURCE-NOTES.txt').write_text(
        'Base: https://github.com/cauliflowermossgrape/idrive7-apps\n'
        'Commit: 180537a0bdf39163046a6855e7928eb35bb47c7b\n'
        'Runtime and TASU transport: MIT, see LICENSE-idrive7-apps.txt.\n'
        'Store catalog format: https://github.com/robertnisipeanu/mgu-store/blob/main/docs/PUBLISHING.md\n'
        'Reference analysis only: https://github.com/emdzej/ediabasx (PolyForm Noncommercial 1.0.0).\n'
        'EdiabasX is not bundled or used by the installed app.\n'
        'No BMW SDK or PRG is included. Legacy BDC IO testing produced no visible lamp effect and NRC22 during release.\n'
        'The D542 timed route produced visible lamps with reported motor noise; its exact physical effect and automatic leveling are not verified.\n'
        'FLM02 StopRoutine was captured from original BMW PRGs offline; FLM channel START framing and physical LED mapping remain unverified.\n')
    # Verify install catalog, archive identity, syntax-independent layout and SDK omission.
    with tarfile.open(fileobj=io.BytesIO(artifact), mode='r:gz') as tar:
        names = tar.getnames()
        if any('node_modules/oap-sdk/' in n for n in names):
            raise SystemExit('SDK unexpectedly included')
        required = ['package/package.json', 'package/javascript/app.js', 'package/rhmiData/application.json', 'package/manifest.json']
        if not all(n in names for n in required):
            raise SystemExit('OAP package is incomplete')
        check = json.load(tar.extractfile('package/package.json'))
        if check['name'] != SPEC['id'] or check['version'] != VERSION or check['mguHmi'] != ['ID7']:
            raise SystemExit('Package identity mismatch')
    archive = ROOT / 'dist' / ('LightShow_ID7_v%s.zip' % VERSION)
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as z:
        for p in sorted(OUT.rglob('*')):
            if p.is_file():
                z.write(p, p.relative_to(OUT).as_posix())
    print(str(archive))
    print('USB OAP package: %d bytes; sha256 %s' % (len(artifact), hashlib.sha256(artifact).hexdigest()))


if __name__ == '__main__':
    main()
