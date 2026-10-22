"""Network-free tests of the Python client against Shafeh's response contract."""
import datetime as dt
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("dl", Path(__file__).parents[1] / "scripts/dl.py")
dl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dl)


class ShafehClientTest(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.args = SimpleNamespace(no_cache=True, refs=False, full=True, no_rashi=False, lang="both")
        self.responses = {
            "/today": {"hebrew_date": {"day": 25, "month_name": "Sivan", "year": 5786, "hebrew": "כה סיון"}, "limudim": [
                {"key": "tehillim", "range": [119, 119], "start_verse": 1, "end_verse": 96},
                {"key": "chitas_tanya", "value": "Tanya · Chapter 1"},
                {"key": "rambam", "value": "Hilchos A 10, Hilchos B 1–2"},
                {"key": "rambam_1", "value": "Hilchos A 10"},
                {"key": "hayom_yom", "value": "25 Sivan", "entry_key": "3-25"},
                {"key": "daf_yomi", "value": "Berakhot 64", "masechet": "berakhot", "amudim": ["64a"], "available": True}
            ]},
            "/learning/chumash": {"available": True, "book": "Bereishis", "parsha": "Bereishis", "aliyah": "Rishon", "verses": [
                {"chapter": 1, "verse": 31, "text": "פסוק א", "english": "verse one", "rashi": ["comment one"]},
                {"chapter": 2, "verse": 1, "text": "פסוק ב", "english": "verse two", "rashi": []}
            ]},
            "/tehillim/119": {"verses": [{"number": n, "text": f"פסוק {n}", "english": f"verse {n}"} for n in range(1, 177)]},
            "/learning/tanya": {"segments": [{"text": "קטע", "english": "the daily English paragraph"}]},
            "/learning/rambam": {"chapters": [
                {"name": "Hilchos A", "hebrew_name": "הלכות א", "chapter": 10, "halachos": [{"text": "הלכה א", "english": "law one"}]},
                {"name": "Hilchos B", "hebrew_name": "הלכות ב", "chapter": 1, "halachos": [{"text": "הלכה ב", "english": "law two"}]},
                {"name": "Hilchos B", "hebrew_name": "הלכות ב", "chapter": 2, "halachos": [{"text": "הלכה ג", "english": "law three"}]}
            ]},
            "/learning/hayom-yom": {"languages": {"he": {"text": ["פתגם"]}, "en": {"text": ["teaching"]}}},
            "/shas/berakhot/64a": {"lines": [{"he": "גמרא"}], "rashi": [{"d": "דיבור", "c": "פירוש"}]}
        }

    def fetch(self, url, use_cache):
        self.assertTrue(url.startswith("https://shafeh.org/api/v1/"), url)
        self.calls.append(url)
        path = url.split("/api/v1", 1)[1].split("?", 1)[0]
        result = self.responses[path]
        if self.args.refs and path == "/learning/chumash":
            return {**result, "verses": [[v["chapter"], v["verse"]] for v in result["verses"]]}
        return result

    def build(self):
        with patch.object(dl, "get_json", self.fetch):
            return dl.build(dt.date(2026, 6, 10), self.args)

    def test_complete_day_uses_only_shafeh_and_exact_psalm_bounds(self):
        result = self.build()
        self.assertEqual([], result["errors"])
        sections = result["sections"]
        self.assertEqual(96, len(sections["tehillim"]["text"]["he"]))
        self.assertEqual("Psalms 119:1-96", sections["tehillim"]["ref"])
        self.assertEqual(["the daily English paragraph"], sections["tanya"]["text"]["en"])
        self.assertEqual(["teaching"], sections["hayom_yom"]["text"]["en"])
        self.assertEqual(1, len(sections["daf_yomi"]["amudim"]))
        self.assertEqual(["דיבור — פירוש"], sections["daf_yomi"]["amudim"][0]["rashi_notes"])
        self.assertNotIn("64b", " ".join(self.calls))

    def test_second_half_of_psalm_119(self):
        row = self.responses["/today"]["limudim"][0]
        row.update(start_verse=97, end_verse=176)
        texts = self.build()["sections"]["tehillim"]["text"]["he"]
        self.assertEqual(80, len(texts))
        self.assertEqual("פסוק 97", texts[0])

    def test_chapter_numbers_survive_crossing_hilchos(self):
        r = self.build()["sections"]["rambam"]["three_perakim"]
        self.assertEqual([10, 1, 2], [c["number"] for c in r["chapters"]])
        self.assertEqual(["law two"], r["chapters"][1]["en"])

    def test_refs_mode_does_not_fetch_text_or_expose_inline_text(self):
        self.args.refs = True
        result = self.build()
        self.assertEqual([], result["errors"])
        self.assertNotIn("/learning/tanya?", " ".join(self.calls))
        self.assertNotIn("/tehillim/119", " ".join(self.calls))
        self.assertNotIn("text", result["sections"]["chumash"])
        self.assertNotIn("text", result["sections"]["hayom_yom"])
        self.assertNotIn("chapters", result["sections"]["rambam"]["three_perakim"])

    def test_no_rashi_and_hebrew_only(self):
        self.args.no_rashi = True
        self.args.lang = "he"
        sections = self.build()["sections"]
        self.assertNotIn("rashi", sections["chumash"])
        self.assertEqual([], sections["daf_yomi"]["amudim"][0]["rashi_notes"])
        self.assertEqual([], sections["tanya"]["text"]["en"])

    def test_unavailable_daf_has_no_fallback(self):
        row = self.responses["/today"]["limudim"][-1]
        row.update(value="Shekalim 2", masechet="shekalim", amudim=[], available=False)
        result = self.build()
        self.assertEqual([], result["sections"]["daf_yomi"]["amudim"])
        self.assertIn("Shekalim 2", result["errors"][0])
        self.assertNotIn("/shas/", " ".join(self.calls))

    def test_failed_section_does_not_discard_other_learning(self):
        del self.responses["/learning/tanya"]
        result = self.build()
        self.assertEqual(1, len(result["errors"]))
        self.assertTrue(result["sections"]["rambam"]["three_perakim"]["text"]["he"])


if __name__ == "__main__":
    unittest.main()
