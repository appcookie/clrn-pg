"""Exercise the installed hook in disposable repositories, without creating commits."""

import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


class PreCommitTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="clrn-pre-commit-")
        self.addCleanup(self.temporary.cleanup)
        self.repo = Path(self.temporary.name) / "repo"
        self.repo.mkdir()
        self.env = {
            **os.environ,
            "PATH": str(Path(sys.executable).parent) + os.pathsep + os.environ["PATH"],
            "PRE_COMMIT_HOME": str(Path(self.temporary.name) / "cache"),
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": os.devnull,
            "PRE_COMMIT_ALLOW_NO_CONFIG": "0",
        }
        # Isolate fixture Git operations from any environment inherited from a hook.
        for key in list(self.env):
            if key.startswith("GIT_") and key not in {"GIT_CONFIG_NOSYSTEM", "GIT_CONFIG_GLOBAL"}:
                del self.env[key]
        self.env.pop("SKIP", None)
        self.run_command("git", "init", "--quiet")
        for name in [".pre-commit-config.yaml", "package.json", "tsconfig.json",
                     "scripts/check-python-static.py"]:
            target = self.repo / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, target)
        (self.repo / "node_modules").symlink_to(ROOT / "node_modules", target_is_directory=True)
        self.write(".gitignore", "node_modules/\nignored.py\n")
        self.write("ios/full/fixture.ts", "export const value: number = 1;\n")
        self.write("fixture.py", "raise RuntimeError('syntax checks must never execute this')\n")
        self.write("README.md", "documentation\n")
        self.run_command("git", "add", ".")
        self.run_command(sys.executable, "-m", "pre_commit", "install")

    def write(self, name, content):
        path = self.repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)

    def run_command(self, *args, success=True):
        result = subprocess.run(args, cwd=self.repo, env=self.env, text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        if success:
            self.assertEqual(result.returncode, 0, result.stdout)
        return result

    def snapshot(self):
        return {
            "index": self.run_command("git", "ls-files", "--stage").stdout,
            "status": self.run_command("git", "status", "--porcelain").stdout,
            "files": {str(path.relative_to(self.repo)): path.read_bytes()
                      for path in self.repo.rglob("*")
                      if path.is_file() and ".git" not in path.parts},
        }

    def hook(self, success):
        before = self.snapshot()
        # This is the exact executable Git invokes before making a commit.
        result = self.run_command(str(self.repo / ".git/hooks/pre-commit"), success=False)
        self.assertEqual(result.returncode == 0, success, result.stdout)
        self.assertEqual(self.snapshot(), before, "hook must preserve index and working files")
        self.assertFalse(list(self.repo.rglob("*.pyc")))
        return result.stdout

    def test_all_files_and_installed_hook_pass_once(self):
        result = self.run_command(sys.executable, "-m", "pre_commit", "run", "--all-files")
        self.assertEqual(result.stdout.count("TypeScript typecheck"), 1)
        self.assertEqual(result.stdout.count("Python syntax (read only)"), 1)
        self.hook(True)

    def test_python_error_blocks_and_fixed_source_passes(self):
        self.write("fixture.py", "def broken(:\n")
        self.run_command("git", "add", "fixture.py")
        output = self.hook(False)
        self.assertIn("SyntaxError", output)
        self.assertIn("fixture.py", output)
        self.write("fixture.py", "value = 1\n")
        self.run_command("git", "add", "fixture.py")
        self.hook(True)

    def test_typescript_error_blocks_with_original_error(self):
        self.write("ios/full/fixture.ts", "export const value: number = 'wrong';\n")
        self.run_command("git", "add", "ios/full/fixture.ts")
        self.assertIn("TS2322", self.hook(False))

    def test_unstaged_python_error_is_restored_after_staged_success(self):
        self.write("fixture.py", "def unstaged_error(:\n")
        self.write("untracked.py", "def untracked_error(:\n")
        self.write("ignored.py", "def ignored_error(:\n")
        self.assertIn("Restored changes", self.hook(True))

    def test_unstaged_fix_is_restored_after_staged_failure(self):
        self.write("fixture.py", "def staged_error(:\n")
        self.run_command("git", "add", "fixture.py")
        self.write("fixture.py", "value = 'unstaged fix'\n")
        output = self.hook(False)
        self.assertIn("SyntaxError", output)
        self.assertIn("Restored changes", output)

    def test_trigger_scopes(self):
        for name, ts, python in [("README.md", False, False),
                                 ("fixture.py", False, True),
                                 ("ios/full/fixture.ts", True, False),
                                 ("package.json", True, True)]:
            with self.subTest(name=name):
                output = self.run_command(sys.executable, "-m", "pre_commit", "run",
                                          "--files", name).stdout
                for label, runs in [("TypeScript typecheck", ts), ("Python syntax (read only)", python)]:
                    line = next(line for line in output.splitlines() if label in line)
                    self.assertIn("Passed" if runs else "Skipped", line)

    def test_static_checker_handles_tracked_deletion(self):
        (self.repo / "fixture.py").unlink()
        self.run_command("npm", "run", "check:python:static")


if __name__ == "__main__":
    unittest.main(verbosity=2)
