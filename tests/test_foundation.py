from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

class FoundationTests(unittest.TestCase):
    def test_required_docs_exist(self):
        for rel in [
            "docs/ARCHITECTURE.md",
            "docs/DECISIONS.md",
            "docs/SECURITY.md",
            "docs/MODERATION.md",
        ]:
            self.assertTrue((ROOT / rel).is_file(), rel)

    def test_no_false_encryption_claim(self):
        html = (ROOT / "apps/web-prototype/index.html").read_text()
        self.assertIn("does not claim real E2EE", html)

    def test_appeals_are_free(self):
        decisions = (ROOT / "docs/DECISIONS.md").read_text()
        self.assertIn("Fair appeals are free", decisions)

    def test_phone_is_not_identity(self):
        decisions = (ROOT / "docs/DECISIONS.md").read_text()
        self.assertIn("Phone number is not identity", decisions)

if __name__ == "__main__":
    unittest.main()
