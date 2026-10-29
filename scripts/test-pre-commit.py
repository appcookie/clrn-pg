"""Exercise real commits with installed hooks in independent, disposable Git fixtures."""

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
        self.repo = (Path(self.temporary.name) / "repo").resolve()
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
        self.run_command("git", "init", "--quiet", "--template=")
        self.assertTrue((self.repo / ".git").is_dir())
        self.assertFalse((self.repo / ".git").is_symlink())
        self.assertEqual(Path(self.run_command("git", "rev-parse", "--absolute-git-dir").stdout.strip()),
                         self.repo / ".git")
        self.assertEqual(self.run_command("git", "remote").stdout, "")
        self.run_command("git", "config", "user.name", "Pre-commit fixture")
        self.run_command("git", "config", "user.email", "pre-commit-fixture@example.invalid")
        self.run_command("git", "config", "commit.gpgsign", "false")
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
        self.initial_commit_output = self.commit(True)

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
            "head": self.run_command("git", "rev-parse", "--verify", "--quiet", "HEAD",
                                     success=False).stdout.strip(),
            "index": self.run_command("git", "ls-files", "--stage").stdout,
            "status": self.run_command("git", "status", "--porcelain").stdout,
            "unstaged": self.run_command("git", "diff", "--binary").stdout,
            "files": {str(path.relative_to(self.repo)): path.read_bytes()
                      for path in self.repo.rglob("*")
                      if path.is_file() and ".git" not in path.parts},
        }

    def commit(self, success):
        before = self.snapshot()
        staged_tree = self.run_command("git", "write-tree").stdout.strip()
        result = self.run_command("git", "commit", "-m", "Fixture change", success=False)
        self.assertEqual(result.returncode == 0, success, result.stdout)
        after = self.snapshot()
        if success:
            self.assertNotEqual(after["head"], before["head"], result.stdout)
            self.assertEqual(self.run_command("git", "rev-parse", "HEAD^{tree}").stdout.strip(),
                             staged_tree, "commit must contain exactly the staged tree")
            self.assertEqual(self.run_command("git", "show", "-s", "--format=%P", "HEAD").stdout.strip(),
                             before["head"], "commit must advance the fixture HEAD by one commit")
            self.assertEqual(self.run_command("git", "diff", "--cached", "--exit-code").stdout, "")
            for field in ["index", "files", "unstaged"]:
                self.assertEqual(after[field], before[field], f"commit must preserve {field}")
        else:
            self.assertEqual(after, before, "failed commit must preserve HEAD, index and working files")
        self.assertFalse(list(self.repo.rglob("*.pyc")))
        return result.stdout

    def test_all_files_and_initial_commit_pass_once(self):
        result = self.run_command(sys.executable, "-m", "pre_commit", "run", "--all-files")
        for output in [result.stdout, self.initial_commit_output]:
            for label in ["TypeScript typecheck", "Python syntax (read only)"]:
                self.assertEqual(output.count(label), 1)
                self.assertIn("Passed", next(line for line in output.splitlines() if label in line))

    def test_python_error_blocks_and_fixed_source_commits(self):
        self.write("fixture.py", "def broken(:\n")
        self.run_command("git", "add", "fixture.py")
        output = self.commit(False)
        self.assertIn("SyntaxError", output)
        self.assertIn("fixture.py", output)
        self.write("fixture.py", "value = 1\n")
        self.run_command("git", "add", "fixture.py")
        self.commit(True)

    def test_typescript_error_blocks_and_fixed_source_commits(self):
        self.write("ios/full/fixture.ts", "export const value: number = 'wrong';\n")
        self.run_command("git", "add", "ios/full/fixture.ts")
        self.assertIn("TS2322", self.commit(False))
        self.write("ios/full/fixture.ts", "export const value: number = 2;\n")
        self.run_command("git", "add", "ios/full/fixture.ts")
        self.commit(True)

    def test_unstaged_python_error_is_restored_after_staged_success(self):
        self.write("fixture.py", "value = 2\n")
        self.run_command("git", "add", "fixture.py")
        self.write("fixture.py", "def unstaged_error(:\n")
        self.write("untracked.py", "def untracked_error(:\n")
        self.write("ignored.py", "def ignored_error(:\n")
        self.assertIn("Restored changes", self.commit(True))
        self.assertEqual(self.run_command("git", "show", "HEAD:fixture.py").stdout, "value = 2\n")
        self.assertIn(" M fixture.py", self.run_command("git", "status", "--porcelain").stdout)

    def test_unstaged_fix_is_restored_after_staged_failure(self):
        self.write("fixture.py", "def staged_error(:\n")
        self.run_command("git", "add", "fixture.py")
        self.write("fixture.py", "value = 'unstaged fix'\n")
        output = self.commit(False)
        self.assertIn("SyntaxError", output)
        self.assertIn("Restored changes", output)
        self.run_command("git", "add", "fixture.py")
        self.commit(True)

    def test_trigger_scopes(self):
        for name, ts, python in [("README.md", False, False),
                                 ("image.png", False, False),
                                 ("fixture.py", False, True),
                                 ("ios/full/fixture.ts", True, False),
                                 ("package.json", True, True),
                                 ("nested/requirements-test.txt", False, True),
                                 (".pre-commit-config.yaml", True, True),
                                 (".github/workflows/fixture.yml", True, True)]:
            with self.subTest(name=name):
                path = self.repo / name
                self.write(name, (path.read_text() if path.exists() else "") + "\n")
                self.run_command("git", "add", name)
                output = self.commit(True)
                for label, runs in [("TypeScript typecheck", ts), ("Python syntax (read only)", python)]:
                    self.assertEqual(output.count(label), 1)
                    line = next(line for line in output.splitlines() if label in line)
                    self.assertIn("Passed" if runs else "Skipped", line)

    def test_static_checker_handles_tracked_deletion(self):
        (self.repo / "fixture.py").unlink()
        self.run_command("npm", "run", "check:python:static")
        self.run_command("git", "add", "fixture.py")
        self.commit(True)
        self.assertNotIn("fixture.py", self.run_command("git", "ls-tree", "--name-only", "HEAD").stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
