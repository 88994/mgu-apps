import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
repo = json.loads((ROOT / 'mgu-repo.json').read_text())
entries = {c['id']: c for c in repo['components']}
for name in ('equalizer', 'mgu-equalizer-dsp'):
    assert name in entries, name
app = json.loads((ROOT / 'apps/equalizer/app.json').read_text())
tool = json.loads((ROOT / 'native/equalizer-dsp/component.json').read_text())
assert app['version'] == tool['version'] == entries['equalizer']['version'] == '0.2.0'
assert entries['equalizer']['requires']['mgu-equalizer-dsp'] == tool['version']
assert entries['mgu_video_hub']['version'] == '0.1.1'
assert entries['mgu_video_hub']['requires']['mgu-equalizer-dsp'] == '0.2.0'
for f in tool['files']:
    assert (ROOT / 'native/equalizer-dsp' / f['path']).is_file(), f
assert 'Group=12202' in (ROOT / 'native/equalizer-dsp/mgu-equalizer-dsp.service').read_text()
assert (ROOT / 'kit/runtime/dsp-client.js').is_file()
print('PASS Store versions, DSP dependency, service files, shared runtime client and socket group')
