"""
The Modal image must install everything the ingest path imports.

WHY THIS TEST EXISTS

A deploy from a clean checkout replaced one made from a working tree that had
an extra `pip_install` entry nobody had committed. The committed image had no
pydantic, `runner.plan` imports `pmc_agent` before it does anything else, and
`pmc_agent` declares its schemas with pydantic - so every plan died on import.
Nothing surfaced it: the failure is inside a try/except that records a study
event, and the ingest simply stopped planning.

The check is static on purpose. Importing the modules here would prove only
that the local engine environment has them, which is the environment that did
not have the problem.
"""

from __future__ import annotations

import ast
import pathlib
import re
import sys

ENGINE = pathlib.Path(__file__).resolve().parent.parent

#: Reachable from splicr.ingest.runner.{discover, plan, process} and from the
#: analysis the process stage calls. A module added to that path is covered the
#: moment it lands, because this walks the directory rather than a list.
ROOTS = [
    "splicr/ingest",
    "splicr/pmc_agent.py",
    "splicr/hits.py",
    "splicr/db.py",
    "splicr/references.py",
    "splicr/pipeline.py",
    "splicr/qc.py",
    "splicr/count.py",
    "splicr/artifacts.py",
    "splicr/r2.py",
]

#: Distributions whose import name differs, and packages that arrive as a
#: dependency of one that is installed explicitly.
PROVIDED_BY = {
    "sklearn": "scikit-learn",
    "botocore": "boto3",
    "dateutil": "python-dateutil",
    "yaml": "pyyaml",
}

#: Installed by micromamba rather than pip, in the same image.
CONDA = {"numpy", "scipy", "pandas", "click", "mageck"}


def _top_level_imports(path: pathlib.Path) -> set[str]:
    names: set[str] = set()
    tree = ast.parse(path.read_text())
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and not node.level and node.module:
            names.add(node.module.split(".")[0])
    return names


def _reachable_third_party() -> dict[str, str]:
    """Third-party top-level module -> the first file that imports it."""
    stdlib = set(sys.stdlib_module_names)
    found: dict[str, str] = {}
    for root in ROOTS:
        base = ENGINE / root
        files = sorted(base.rglob("*.py")) if base.is_dir() else ([base] if base.exists() else [])
        for file in files:
            try:
                names = _top_level_imports(file)
            except SyntaxError:  # pragma: no cover - a parse failure is its own test's problem
                continue
            for name in names:
                if name in stdlib or name in {"splicr", "__future__"}:
                    continue
                found.setdefault(name, str(file.relative_to(ENGINE)))
    return found


def _image_packages() -> set[str]:
    """Distribution names the image installs, from pip_install and micromamba."""
    source = (ENGINE / "modal_app.py").read_text()
    packages: set[str] = set(CONDA)
    for call in re.findall(r"\.(?:pip_install|micromamba_install)\((.*?)\n    \)", source, re.S):
        for literal in re.findall(r'"([^"]+)"', call):
            if "=" in literal and literal.startswith(("channels", "-")):
                continue
            name = re.split(r"[<>=\[]", literal)[0].strip().lower()
            if name:
                packages.add(name)
    return packages


def test_every_import_on_the_ingest_path_is_installed_in_the_image():
    installed = _image_packages()
    missing = []
    for module, where in sorted(_reachable_third_party().items()):
        distribution = PROVIDED_BY.get(module, module).lower()
        if distribution in installed or module.lower() in installed:
            continue
        # A module that the repository itself defines is not a dependency.
        if (ENGINE / "splicr" / f"{module}.py").exists() or (ENGINE / "splicr" / module).is_dir():
            continue
        missing.append(f"{module} (imported by {where})")
    assert not missing, (
        "engine/modal_app.py does not install these, so the deployed ingest will "
        "die on import:\n  " + "\n  ".join(missing)
    )


def test_pydantic_stays_pinned_in_the_image():
    # Named explicitly because this is the one that actually broke, and the
    # general test above would pass on an unpinned install that drifts to a
    # major version the schemas do not parse under.
    source = (ENGINE / "modal_app.py").read_text()
    assert re.search(r'"pydantic==2\.\d+\.\d+"', source), \
        "the image must install a pinned pydantic; runner.plan imports pmc_agent first"


def test_the_image_pin_matches_the_engine_requirements():
    image = re.search(r'"pydantic==([\d.]+)"', (ENGINE / "modal_app.py").read_text())
    pinned = re.search(r"^pydantic==([\d.]+)$", (ENGINE / "requirements.txt").read_text(), re.M)
    assert image and pinned, "both files must pin pydantic"
    assert image[1] == pinned[1], (
        f"the Modal image pins pydantic {image[1]} and engine/requirements.txt pins {pinned[1]}; "
        "the deployed schemas would not be the ones the tests exercise"
    )
