"""Offline checks for the GitHub-repository MGU Store build dispatcher."""

import importlib.util
import json
from pathlib import Path
from unittest import TestCase, mock, main


SCRIPT = Path(__file__).resolve().parents[1] / "tools" / "build_store_app.py"
MODULES = SCRIPT.parent


class StoreBuildTests(TestCase):
    @classmethod
    def setUpClass(cls):
        import sys
        sys.path.insert(0, str(MODULES))
        spec = importlib.util.spec_from_file_location("store_builder", SCRIPT)
        cls.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)

    def test_ambient_uses_unmodified_standard_builder(self):
        with mock.patch.object(self.module.subprocess, "run") as invoke, \
             mock.patch.object(self.module, "patch_artifacts") as patcher:
            self.assertEqual(self.module.main(["g21_ambient"]), 0)
        invoke.assert_called_once()
        patcher.assert_not_called()

    def test_wheelheat_uses_manifest_start_mode_for_installable_packages(self):
        with mock.patch.object(self.module.subprocess, "run") as invoke, \
             mock.patch.object(self.module, "patch_artifacts", return_value=("test.tgz", "test.mgu")) as patcher:
            self.assertEqual(self.module.main(["g21_wheelheat"]), 0)
        invoke.assert_called_once()
        manifest = json.loads((SCRIPT.parents[1] / "apps" / "g21_wheelheat" / "app.json").read_text(encoding="utf-8"))
        patcher.assert_called_once_with(SCRIPT.parents[1], manifest["mguAppStartType"])

    def test_unknown_app_rejected_before_build(self):
        with mock.patch.object(self.module.subprocess, "run") as invoke:
            self.assertEqual(self.module.main(["unknown_app"]), 2)
        invoke.assert_not_called()


if __name__ == "__main__":
    main()
