#!/usr/bin/env python3
"""MGU Store source-repository build entry point.

The store invokes this script as `python3 tools/build_store_app.py <app-id>`.
All apps use the repository's existing BMW-SDK build tool; WheelHeat also gets
the native mgu-deploy autostart metadata added to the two generated archives.
No head-unit files, service units or other installed apps are modified here.
"""

import subprocess
import sys
from pathlib import Path

from build_wheelheat_autostart import APP_ID, BuildError, patch_artifacts


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 1 or not args[0] or args[0].startswith("-"):
        print("Usage: python3 tools/build_store_app.py <app-id>", file=sys.stderr)
        return 2

    app_id = args[0]
    root = Path(__file__).resolve().parents[1]
    if not (root / "apps" / app_id / "app.json").is_file():
        print("Unknown app: " + app_id, file=sys.stderr)
        return 2

    try:
        subprocess.run([sys.executable, str(root / "kit" / "tools" / "build.py"), app_id],
                       cwd=root, check=True)
        if app_id == APP_ID:
            npm, mgu = patch_artifacts(root, "autostart")
            print("Verified WheelHeat autostart metadata in " + str(npm) + " and " + str(mgu))
    except (BuildError, OSError, subprocess.CalledProcessError, ValueError) as exc:
        print("MGU Store build failed: " + str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
