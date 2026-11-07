"""Exercise the scoped gate against disposable Python sources and real entry points."""

from contextlib import redirect_stderr
import io
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from python_complexity import CHECK_TEST, REQUIRED, ROOT, TOOLS, check, measure, scan


def branch_source(decisions, name='candidate'):
    branches = ''.join(f'    if value == {index}:\n        return {index}\n'
                       for index in range(decisions))
    return f'def {name}(value):  # noqa: C901\n' + branches + '    return None\n'


class ComplexityGateTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='clrn-complexity-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        for name in REQUIRED:
            self.write('e2e/mitmproxy/' + name, 'def fixture():\n    pass\n')
        self.write(CHECK_TEST, 'def test_fixture():\n    pass\n')
        for name in TOOLS:
            self.write(name, 'def tool():\n    pass\n')
        shutil.copyfile(ROOT / 'scripts/python_complexity.py', self.root / 'scripts/python_complexity.py')

    def write(self, name, source):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(source)

    def run_entry(self, *options):
        return subprocess.run([sys.executable, *options, '-B', 'scripts/python_complexity.py'],
                              cwd=self.root, capture_output=True, text=True)

    def assert_entry(self, status, message):
        result = self.run_entry()
        self.assertEqual(result.returncode, status, result.stderr)
        self.assertIn(message, result.stderr)
        self.assertFalse(list(self.root.rglob('*.pyc')))

    def test_test_support_three_passes_four_fails_despite_suppression(self):
        self.write('e2e/mitmproxy/helper.py', branch_source(2))
        self.assert_entry(0, '0 violations')
        self.write('e2e/mitmproxy/helper.py', '# ruff: noqa\n' + branch_source(3))
        self.assert_entry(1, 'complexity 4 > 3')

    def test_tool_six_passes_seven_fails(self):
        self.write('scripts/check-python-static.py', branch_source(5))
        self.assert_entry(0, '0 violations')
        self.write('scripts/check-python-static.py', branch_source(6))
        self.assert_entry(1, 'complexity 7 > 6')

    def test_nested_callbacks_and_classes_are_measured_independently(self):
        source = ('async def outer():\n'
                  '    class Local:\n'
                  '        async def callback(self, value):\n'
                  '            return value and value and value and value\n'
                  '    return Local\n')
        self.assertEqual([(row['function'], row['complexity']) for row in measure(source, 'nested.py')],
                         [('outer', 1), ('outer.Local.callback', 4)])
        self.write('e2e/mitmproxy/new/nested.py', source)
        self.assert_entry(1, 'outer.Local.callback complexity 4 > 3')

    def test_lambdas_in_defaults_decorators_and_callbacks_cannot_bypass_gate(self):
        source = ('@(lambda: a and b and c and d)\n'
                  'def outer(callback=lambda: a and b and c and d):\n'
                  '    return lambda: a and b and c and d\n')
        rows = measure(source, 'lambdas.py')
        self.assertEqual(sorted(row['complexity'] for row in rows), [1, 4, 4, 4])
        self.write('e2e/mitmproxy/lambdas.py', source)
        self.assert_entry(1, '3 violations')

    def test_asserts_use_radon_no_assert_semantics(self):
        source = ('def candidate(value):\n'
                  '    assert value and value and value\n'
                  '    return [item for item in value if item]\n')
        self.assertEqual(measure(source, 'asserts.py')[0]['complexity'], 3)

    def test_radon_decision_rules_cover_match_except_else_and_comprehensions(self):
        cases = [('if a and b:\n    pass', 3),
                 ('try:\n    pass\nexcept ValueError:\n    pass\nelse:\n    pass', 3),
                 ('for x in xs:\n    pass\nelse:\n    pass', 3),
                 ('match x:\n    case 1:\n        pass\n    case 2:\n        pass\n    case _:\n        pass', 3)]
        for body, expected in cases:
            source = 'def candidate():\n' + '\n'.join('    ' + line for line in body.splitlines())
            self.assertEqual(measure(source, 'decisions.py')[0]['complexity'], expected)

    def test_invalid_syntax_in_adjacent_helper_fails(self):
        self.write('e2e/mitmproxy/invalid.py', 'def invalid(:\n')
        self.assert_entry(1, 'SyntaxError')

    def test_missing_required_source_fails(self):
        (self.root / 'e2e/mitmproxy/network_faults.py').unlink()
        self.assert_entry(1, 'Missing scoped source')

    def test_missing_dependency_fails(self):
        result = self.run_entry('-S')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("No module named 'radon'", result.stderr)

    def test_empty_scan_fails(self):
        with patch('python_complexity.scoped_paths', return_value=[]):
            with self.assertRaisesRegex(ValueError, 'Empty complexity scan'):
                scan(self.root)

    def test_empty_e2e_scope_cannot_hide_behind_checker_functions(self):
        for name in REQUIRED:
            self.write('e2e/mitmproxy/' + name, '# empty\n')
        self.assert_entry(1, 'Empty complexity scan')

    def test_syntax_failure_is_not_reported_as_success(self):
        self.write('e2e/mitmproxy/invalid.py', 'return 42\n')
        self.assert_entry(1, 'SyntaxError')

    def test_check_returns_nonzero_for_violation(self):
        self.write('e2e/mitmproxy/helper.py', branch_source(3))
        with redirect_stderr(io.StringIO()) as diagnostics:
            self.assertTrue(check(self.root))
        self.assertIn('complexity 4 > 3', diagnostics.getvalue())


if __name__ == '__main__':
    unittest.main()
