#!/usr/bin/env python3
"""Generate self-contained, readable Node8-compatible bundles from upstream cores.

python3 tools/vendor_retro_cores.py /path/to/serverboy.js/src /path/to/jssnes/src /path/to/nes-js/src

serverboy.js: GPL-2.0, https://github.com/danShumway/serverboy.js
jssnes: MIT, https://github.com/deepneko/jssnes
nes-js: MIT, https://github.com/takahirox/nes-js
"""
import pathlib
import re
import sys

root = pathlib.Path(__file__).resolve().parents[1] / 'apps/mgu_gamestation'
boy = pathlib.Path(sys.argv[1])
snes = pathlib.Path(sys.argv[2])
nes_mit = pathlib.Path(sys.argv[3])


def pack(modules, output, title, root_module, transform):
    with (root / output).open('w', encoding='utf-8') as dst:
        dst.write("'use strict';\n/* " + title + " - original source embedded below; see corresponding license. */\n")
        dst.write('(function () {\nvar registry = Object.create(null), cache = Object.create(null);\n')
        if output == 'snes_vendor.js':
            dst.write('// Isolate upstream diagnostic globals; Node8 does not expose globalThis.\nvar globalThis = Object.create(null);\n')
            dst.write('// Upstream emits per-instruction debug logs; silence them in the game loop.\n')
            dst.write('var console = {log:function(){},warn:function(){},error:function(){}};\n')
        dst.write('function load(id) { if (!registry[id]) throw Error("Missing core module: " + id);\n')
        dst.write('if (cache[id]) return cache[id].exports; var m={exports:{}}; cache[id]=m;\n')
        dst.write('registry[id](m,m.exports,function(p){var parts=id.split("/");parts.pop();\n')
        dst.write('p.split("/").forEach(function(part){if(part==="..")parts.pop();else if(part!==".")parts.push(part);});\n')
        dst.write('return load(parts.join("/").replace(/\\.js$/, ""));});return m.exports;}\n')
        for name, file in modules:
            src = transform(file.read_text(encoding='utf-8'))
            # Keep committed vendored sources deterministic and whitespace-clean.
            src = '\n'.join(line.rstrip(' \t') for line in src.split('\n'))
            dst.write('\nregistry[' + repr(name) + '] = function(module,exports,require) {\n')
            dst.write(src)
            dst.write('\n};\n')
        if output == 'nes_vendor.js':
            dst.write('module.exports = {Nes:load("Nes").Nes,Rom:load("Rom").Rom,Joypad:load("Joypad").Joypad};\n})();\n')
        else:
            dst.write('module.exports = load(' + repr(root_module) + ');\n})();\n')
    print(output, (root / output).stat().st_size, 'bytes')


boyfiles = [(file.relative_to(boy).with_suffix('').as_posix(), file)
            for file in sorted(boy.rglob('*.js')) if file.name != 'bundle.js']
pack(boyfiles, 'gb_vendor.js', 'serverboy.js Game Boy and Color / GPL-2.0',
     'interface', lambda s: s)

needed = ['CPU', 'PPU', 'APU', 'MMU', 'DSP', 'DSP1', 'SNES']
snfiles = [(name, snes / (name + '.js')) for name in needed]


def compat(source):
    # Original module-format conversion only. Keep upstream algorithms unchanged.
    deps = []
    def imported(match):
        deps.append((match.group(1), match.group(2)))
        return ''
    source = re.sub(r"^import\s*\{\s*(\w+)\s*\}\s*from\s*['\"]\.\/(\w+)\.js['\"];\s*$",
                    imported, source, flags=re.M)
    exported = re.findall(r'^export class (\w+)', source, re.M)
    source = re.sub(r'^export class (\w+)', r'class \1', source, flags=re.M)
    source = source.replace('globalThis._snesMMU?.apu', '(globalThis._snesMMU && globalThis._snesMMU.apu)')
    # Upstream debug print assumes a particular commercial ROM is loaded.
    source = source.replace('data[0x2766D].toString(16)', '(data[0x2766D] || 0).toString(16)')
    source = source.replace('this.rom[0x2766D].toString(16)', '(this.rom[0x2766D] || 0).toString(16)')
    source = ''.join('const ' + var + " = require('./" + dep + "')." + var + ';\n'
                     for var, dep in deps) + source
    source += '\n' + '\n'.join('exports.' + name + ' = ' + name + ';' for name in exported) + '\n'
    return source


pack(snfiles, 'snes_vendor.js', 'jssnes SNES / MIT', 'SNES', compat)


def nes_compat(source):
    deps = []
    def imported(match):
        names = [x.strip() for x in match.group(1).split(',')]
        deps.append((names, match.group(2)))
        return ''
    source = re.sub(r"^import\s*\{([^}]+)\}\s*from\s*['\"]\.\/(\w+)\.js['\"];\s*$",
                    imported, source, flags=re.M)
    exports = []
    def export_names(match):
        exports.extend([x.strip() for x in match.group(1).split(',')])
        return ''
    source = re.sub(r'^export\s*\{([^}]+)\};', export_names, source, flags=re.M)
    intro = ''.join('const {' + ','.join(names) + "} = require('./" + dep + "');\n"
                    for names, dep in deps)
    source = intro + source
    source += '\n' + '\n'.join('exports.' + name + ' = ' + name + ';' for name in exports)
    return source


nesfiles = [(file.stem, file) for file in sorted(nes_mit.glob('*.js'))]
pack(nesfiles, 'nes_vendor.js', 'nes-js NES / MIT', 'Nes', nes_compat)
