#!/usr/bin/env python3
"""Build GIF Home and include its widget in the Store's .tgz source package.

The repository's regular builder already produces the installed widget layout
in dist/gif_home/rhmiDataStartWidget. This small, app-specific step writes the
equivalent source-package layout used by the MGU Store installation flow.
"""

import json
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile


ROOT = Path(__file__).resolve().parents[1]
APP_ID = "gif_home"


def package_widget(stage):
    stage = Path(stage)
    installed = stage / "rhmiDataStartWidget"
    source = stage / "source" / "rhmiDataStartWidget"
    for rel in ("application.json", "uiDescription/application.xml", "uiDescription/uiDescription.json"):
        if not (installed / rel).is_file():
            raise FileNotFoundError("Widget install resource missing: " + str(installed / rel))

    app = json.loads((installed / "application.json").read_text(encoding="utf-8"))["application"]
    required = ("uuid", "type", "name", "vendor", "version", "defaultLanguage",
                "stringBundleUuid", "resourceBundleUuid", "entryPoints")
    if app["type"] != "StartWidget":
        raise ValueError("Unexpected widget type: " + str(app["type"]))

    # Generated source package: safe to regenerate, never touches installed HU files.
    if source.exists():
        shutil.rmtree(source)
    descriptions = source / "uiDescriptions" / "ID7"
    variants = source / "variantGroups" / "Common"
    descriptions.mkdir(parents=True)
    shutil.copy(installed / "uiDescription" / "application.xml", descriptions / "application.xml")
    shutil.copy(installed / "uiDescription" / "uiDescription.json", descriptions / "uiDescription.json")
    shutil.copytree(installed / "strings", variants / "texts")
    shutil.copytree(installed / "resources", variants / "images")

    manifest = {
        "schemaVersion": "1.3.0",
        "application": {key: app[key] for key in required},
    }
    manifest["application"]["uiDescriptions"] = [{
        "applicationFilePath": "./uiDescriptions/ID7/application.xml",
        "uiDescriptionFilePath": "./uiDescriptions/ID7/uiDescription.json",
        "hmi": ["ID7"],
    }]
    manifest["application"]["variantGroups"] = [{
        "stringsPath": "./variantGroups/Common/texts",
        "resourcesPath": "./variantGroups/Common/images",
        "hmi": ["ID7"],
        "brands": ["BMW"],
    }]
    (source / "application.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return source


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    if args != [APP_ID]:
        print("Usage: python3 tools/build_gif_home.py gif_home", file=sys.stderr)
        return 2
    subprocess.run([sys.executable, str(ROOT / "kit" / "tools" / "build.py"), APP_ID],
                   cwd=str(ROOT), check=True)
    stage = ROOT / "dist" / APP_ID
    package_widget(stage)
    version = json.loads((ROOT / "apps" / APP_ID / "app.json").read_text(encoding="utf-8"))["version"]
    result = ROOT / "dist" / (APP_ID + "@" + version + ".tgz")
    temporary = result.with_name(result.name + ".new")
    try:
        with tarfile.open(temporary, "w:gz") as archive:
            archive.add(stage / "source", arcname="package")
        temporary.replace(result)
    finally:
        if temporary.exists():
            temporary.unlink()
    print("GIF Home Store widget included in " + str(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
