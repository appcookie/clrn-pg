"""Compile tracked Python sources in memory, without imports, execution or .pyc files."""

from pathlib import Path
import subprocess
import sys
import traceback


def main():
    root = Path(subprocess.check_output(
        ["git", "rev-parse", "--show-toplevel"], text=True,
    ).strip())
    files = subprocess.check_output(
        ["git", "ls-files", "--cached", "--deduplicate", "-z", "--", "*.py"], cwd=root,
    ).split(b"\0")
    checked = 0
    failed = False
    for name in files:
        if not name:
            continue
        path = root / name.decode(sys.getfilesystemencoding(), errors="surrogateescape")
        if not path.exists():  # A tracked file may have been deleted in this checkout.
            continue
        try:
            compile(path.read_bytes(), str(path.relative_to(root)), "exec", dont_inherit=True)
            checked += 1
        except (SyntaxError, ValueError, OSError) as error:
            sys.stderr.write("".join(traceback.format_exception_only(type(error), error)))
            failed = True
    print(f"Python syntax: {checked} tracked files checked (no files written).")
    return int(failed)


if __name__ == "__main__":
    sys.exit(main())
