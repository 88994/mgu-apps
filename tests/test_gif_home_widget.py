"""Regression checks for the Store-installable GIF Home start-widget bundle."""

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "tools" / "build_gif_home.py"
module_spec = importlib.util.spec_from_file_location("gif_home_build", WRAPPER)
builder = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(builder)


class GifHomeWidgetTests(unittest.TestCase):
    def test_widget_is_packaged_for_store_and_native_installer(self):
        with tempfile.TemporaryDirectory(prefix="gif-home-widget-") as d:
            stage = Path(d)
            native = stage / "rhmiDataStartWidget"
            for name in ("uiDescription", "strings", "resources"):
                (native / name).mkdir(parents=True)
            example = {"schemaVersion": "1.3.0", "application": {
                "uuid": "example-widget-uuid", "type": "StartWidget", "name": "gif_home_widget",
                "vendor": "custom", "version": "1.0", "defaultLanguage": "en_GB",
                "stringBundleUuid": "example-strings", "resourceBundleUuid": "example-resources",
                "entryPoints": [],
            }}
            (native / "application.json").write_text(json.dumps(example), encoding="utf-8")
            (native / "uiDescription" / "application.xml").write_text("<application/>", encoding="utf-8")
            (native / "uiDescription" / "uiDescription.json").write_text("{}", encoding="utf-8")
            (native / "strings" / "de_DE.json").write_text("{}", encoding="utf-8")
            (native / "resources" / "gif_home_widget_icon.png").write_bytes(b"test-icon")

            package = builder.package_widget(stage)
            package_app = json.loads((package / "application.json").read_text(encoding="utf-8"))
            self.assertEqual(package_app["application"]["type"], "StartWidget")
            self.assertEqual(package_app["application"]["uiDescriptions"][0]["hmi"], ["ID7"])
            self.assertTrue((package / "uiDescriptions" / "ID7" / "uiDescription.json").is_file())
            self.assertTrue((package / "variantGroups" / "Common" / "texts" / "de_DE.json").is_file())
            self.assertEqual((package / "variantGroups" / "Common" / "images" /
                              "gif_home_widget_icon.png").read_bytes(), b"test-icon")

    def test_standard_gif_resource_is_included(self):
        data = json.loads((ROOT / "apps" / "gif_home" / "resources" / "demo.json").read_text(encoding="utf-8"))
        import base64
        gif = base64.b64decode(data["base64"], validate=True)
        self.assertTrue(gif.startswith(b"GIF89a") or gif.startswith(b"GIF87a"))
        self.assertLessEqual(len(gif), 6 * 1024 * 1024)


if __name__ == "__main__":
    unittest.main()
