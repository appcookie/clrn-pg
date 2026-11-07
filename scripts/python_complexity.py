"""Read-only, scope-specific Radon gate. No baseline or suppression comments."""

import ast
import json
from pathlib import Path
import sys
import tokenize

from radon.visitors import ComplexityVisitor

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ('scripts/python_complexity.py', 'scripts/check-python-static.py')
CHECK_TEST = 'scripts/test_python_complexity.py'
REQUIRED = ('network_faults.py', 'replay_control.py', 'response_overrides.py',
            'test_network_faults.py', 'test_replay_control.py',
            'test_response_overrides.py', 'test_response_overrides_integration.py')


class LocalComplexity(ComplexityVisitor):
    """Nested definitions are measured separately, including lambdas."""

    def visit_FunctionDef(self, node):
        pass

    visit_AsyncFunctionDef = visit_FunctionDef
    visit_ClassDef = visit_FunctionDef
    visit_Lambda = visit_FunctionDef


def complexity(node):
    visitor = LocalComplexity(no_assert=True)
    body = [node.body] if isinstance(node, ast.Lambda) else node.body
    for statement in body:
        visitor.visit(statement)
    return visitor.complexity


class Definitions(ast.NodeVisitor):
    def __init__(self):
        self.parents = []
        self.rows = []

    def visit_ClassDef(self, node):
        self.parents.append(node.name)
        self.generic_visit(node)
        self.parents.pop()

    def visit_FunctionDef(self, node):
        name = getattr(node, 'name', f'<lambda>@{node.lineno}:{node.col_offset}')
        self.rows.append({'function': '.'.join([*self.parents, name]),
                          'line': node.lineno, 'complexity': complexity(node)})
        self.parents.append(name)
        self.generic_visit(node)
        self.parents.pop()

    visit_AsyncFunctionDef = visit_FunctionDef
    visit_Lambda = visit_FunctionDef


def measure(source, filename):
    tree = ast.parse(source, filename=filename)
    compile(tree, filename, 'exec', dont_inherit=True)
    visitor = Definitions()
    visitor.visit(tree)
    return visitor.rows


def scoped_paths(root):
    directory = root / 'e2e/mitmproxy'
    for name in REQUIRED:
        if not (directory / name).is_file():
            raise ValueError(f'Missing scoped source: {directory / name}')
    # All adjacent/new helpers get the test-support limit, regardless of filename.
    paths = [(path, 3) for path in sorted(directory.rglob('*.py'))]
    paths.append((root / CHECK_TEST, 3))
    paths.extend((root / name, 6) for name in TOOLS)
    return paths


def scan(root=ROOT):
    rows = []
    for path, limit in scoped_paths(root):
        with tokenize.open(path) as source:
            functions = measure(source.read(), str(path))
        rows.extend(dict(row, file=path.relative_to(root).as_posix(), limit=limit)
                    for row in functions)
    if not any(row['file'].startswith('e2e/mitmproxy/') for row in rows):
        raise ValueError('Empty complexity scan: no E2E functions')
    return rows


def check(root=ROOT, report=False):
    rows = scan(root)
    if report:
        print(json.dumps(rows, indent=2))
    violations = [row for row in rows if row['complexity'] > row['limit']]
    for row in violations:
        print(f"{row['file']}:{row['line']}: {row['function']} "
              f"complexity {row['complexity']} > {row['limit']}", file=sys.stderr)
    print(f'Python scoped complexity: {len(rows)} functions, {len(violations)} violations.',
          file=sys.stderr)
    return bool(violations)


if __name__ == '__main__':
    sys.exit(check(report='--report' in sys.argv[1:]))
