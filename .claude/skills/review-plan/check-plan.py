#!/usr/bin/env python3
"""Mechanical validation of a {TICKET}-PLAN.md (+ contracts). Objective failures only.

Run: uv run --with pyyaml .claude/skills/review-plan/check-plan.py <TICKET>-PLAN.md
     uv run --with pyyaml .claude/skills/review-plan/check-plan.py --selftest
"""

import re
import subprocess
import sys
from pathlib import Path

REPOS = {
    "rohan_api": "rohan_api-parent/rohan_api",
    "rohan_ui": "rohan_ui-parent/rohan_ui",
    "rohan_python_api": "rohan-python-api",
    "onering": "ONERING",
    "Database": "Database",
}
REQUIRED_META = ["phase", "title", "tags", "repo", "base_branch", "depends_on", "files"]
REQUIRED_SECTIONS = [
    "Problem statement", "architectural observations", "Assumptions", "Open questions",
    "Implementation phases", "parallelism", "Phase context summaries", "Jira ticket",
]
# Samwise size math ignores these
NON_SUBSTANTIVE = re.compile(r"(\.md$|\.lock$|\.spec\.|\.test\.|(^|/)tests?/|__snapshots__|\.(png|jpe?g|svg|gif)$)")

findings = []  # (severity, message)


def add(sev, msg):
    findings.append((sev, msg))


def check_meta(phases):
    """Structural checks that need no filesystem. Pure — covered by --selftest."""
    out = []
    nums = [p.get("phase") for p in phases]
    if sorted(nums) != list(range(1, len(nums) + 1)):
        out.append(("BLOCKER", f"phase numbers must be unique and contiguous from 1, got {nums}"))
    by_num = {p.get("phase"): p for p in phases}
    for p in phases:
        n, repo = p.get("phase"), p.get("repo")
        for f in REQUIRED_META:
            if p.get(f) is None:
                out.append(("BLOCKER", f"phase {n}: missing required phase-meta field `{f}`"))
        if not p.get("verification"):
            out.append(("MAJOR", f"phase {n}: no `verification` commands — implement-phase has nothing "
                                 f"to run to prove the phase works"))
        if repo not in REPOS:
            out.append(("BLOCKER", f"phase {n}: repo `{repo}` is not one of {list(REPOS)}"))
        deps = p.get("depends_on") or []
        for d in deps:
            if d not in by_num:
                out.append(("BLOCKER", f"phase {n}: depends_on {d} — no such phase"))
            elif d >= n:
                out.append(("BLOCKER", f"phase {n}: depends_on {d} is not an earlier phase (cycle/forward ref)"))
        base = p.get("base_branch")
        same_repo_deps = [d for d in deps if by_num.get(d, {}).get("repo") == repo]
        if n == 1 or not same_repo_deps:
            # roots off a real base branch (`base`, `main`, `develop`, a feature branch) — anything but a stack ref
            if re.fullmatch(r"phase-\d+", str(base)):
                out.append(("BLOCKER", f"phase {n}: base_branch `{base}` but it has no same-repo dependency "
                                       f"to stack on — must be a base branch (`base`/`main`/...)"))
        else:
            m = re.fullmatch(r"phase-(\d+)", str(base))
            if not m:
                out.append(("BLOCKER", f"phase {n}: base_branch `{base}` must be `phase-N`"))
            elif int(m.group(1)) not in same_repo_deps:
                out.append(("BLOCKER", f"phase {n}: base_branch `{base}` is not a same-repo "
                                       f"dependency (same-repo deps: {same_repo_deps})"))
        subst = [f for f in (p.get("files") or []) if not NON_SUBSTANTIVE.search(f)]
        if len(subst) > 25:
            out.append(("MAJOR", f"phase {n}: {len(subst)} substantive files — over the Samwise 25-file "
                                 f"ceiling, PR will ESCALATE. Split it or add the intentional-escalation note."))
    return out


def parse_phases(text):
    import yaml
    phases = []
    for block in re.findall(r"```phase-meta\n(.*?)```", text, re.S):
        try:
            phases.append(yaml.safe_load(block) or {})
        except yaml.YAMLError as e:
            add("BLOCKER", f"phase-meta block does not parse as YAML: {e}")
    return phases


def repo_files(root, repo):
    path = root / REPOS[repo]
    if not path.is_dir():
        add("BLOCKER", f"repo path not found: {path}")
        return None
    r = subprocess.run(["git", "-C", str(path), "ls-files"], capture_output=True, text=True)
    return set(r.stdout.splitlines()) if r.returncode == 0 else set()


def check_files(root, phases):
    cache = {}
    for p in phases:
        repo = p.get("repo")
        if repo not in REPOS:
            continue
        tracked = cache.setdefault(repo, repo_files(root, repo))
        if tracked is None:
            continue
        basenames = {f.rsplit("/", 1)[-1] for f in tracked}
        for f in p.get("files") or []:
            if f in tracked:
                continue
            if (root / REPOS[repo] / f).parent.is_dir():
                continue  # new file in an existing directory — expected
            hint = " (basename exists elsewhere — likely wrong path)" if f.rsplit("/", 1)[-1] in basenames else ""
            add("BLOCKER", f"phase {p.get('phase')}: file `{f}` does not exist in {repo} and its "
                           f"directory does not either{hint}")


def check_verification(root, phases):
    import json
    scripts = {}
    for p in phases:
        repo = p.get("repo")
        if repo not in REPOS:
            continue
        pkg = root / REPOS[repo] / "package.json"
        if repo not in scripts:
            scripts[repo] = set(json.loads(pkg.read_text()).get("scripts", {})) if pkg.is_file() else None
        for cmd in p.get("verification") or []:
            m = re.match(r"(?:npm|pnpm|yarn)\s+run\s+([\w:-]+)", cmd)
            if m and scripts[repo] is not None and m.group(1) not in scripts[repo]:
                add("BLOCKER", f"phase {p.get('phase')}: verification `{cmd}` — no `{m.group(1)}` "
                               f"script in {repo}/package.json")
            if not (root / REPOS[repo]).is_dir():
                continue
            for tok in re.findall(r"\S+\.(?:ts|py|js)\b", cmd):
                if not (root / REPOS[repo] / tok).exists():
                    add("INFO", f"phase {p.get('phase')}: verification target `{tok}` does not exist yet "
                                f"(fine if this phase creates it)")


def check_contracts(text, phases, contracts_path):
    if not contracts_path.is_file():
        add("BLOCKER", f"contracts file not found: {contracts_path}")
        return
    ctext = contracts_path.read_text()
    headings = set()
    for h in re.findall(r"^#{2,4}\s+(\d+(?:\.\d+)*)", ctext, re.M):
        headings.add(h)
    mapped = {}
    for row in re.findall(r"^\|\s*(\d+(?:\.\d+)*)[^|]*\|\s*([^|]+)\|", ctext, re.M):
        mapped[row[0]] = row[1].strip()
    claimed = set()
    for p in phases:
        for c in p.get("contracts") or []:
            m = re.match(r"(\d+(?:\.\d+)*)", str(c))
            if not m:
                add("MINOR", f"phase {p.get('phase')}: contract ref `{c}` has no leading section number")
                continue
            sec = m.group(1)
            claimed.add(sec)
            if sec not in headings:
                add("BLOCKER", f"phase {p.get('phase')}: contract `{c}` — section {sec} is not a "
                               f"heading in {contracts_path.name}")
            elif sec in mapped and str(p.get("phase")) not in mapped[sec]:
                add("MINOR", f"phase {p.get('phase')}: claims contract {sec}, but the contract→phase "
                             f"table maps it to `{mapped[sec]}`")
    for sec, phs in mapped.items():
        if sec not in claimed:
            add("MAJOR", f"contract {sec} is mapped to phase(s) `{phs}` in the table but no phase-meta "
                         f"claims it — that work is unowned")


def check_sections(text, phases):
    for s in REQUIRED_SECTIONS:
        if not re.search(re.escape(s), text, re.I):
            add("MAJOR", f"plan is missing the required `{s}` section")
    m = re.search(r"#+\s*Phase context summaries(.*?)(?=\n#{1,2}\s|\Z)", text, re.S | re.I)
    if m:
        for p in phases:
            if not re.search(rf"Phase\s+{p.get('phase')}\b", m.group(1)):
                add("MAJOR", f"no phase context summary for phase {p.get('phase')} — implement-phase "
                             f"agents read those instead of the full plan")


def selftest():
    bad = [
        {"phase": 1, "title": "a", "tags": [], "repo": "rohan_api", "base_branch": "phase-0",
         "depends_on": [], "files": [], "verification": []},
        {"phase": 2, "title": "b", "tags": [], "repo": "rohan_ui", "base_branch": "phase-1",
         "depends_on": [1], "files": [], "verification": []},
        {"phase": 3, "title": "c", "tags": [], "repo": "rohan_ui", "base_branch": "base",
         "depends_on": [4], "files": [], "verification": []},
        {"phase": 4, "title": "d", "tags": [], "repo": "rohan_api", "base_branch": "phase-3",
         "depends_on": [1], "files": [], "verification": []},
    ]
    msgs = " | ".join(m for _, m in check_meta(bad))
    assert "phase 1: base_branch `phase-0`" in msgs, msgs           # phase 1 must be `base`
    assert "phase 2: base_branch `phase-1` but it has no same-repo" in msgs, msgs  # cross-repo stack
    assert "phase 3: depends_on 4 is not an earlier phase" in msgs, msgs
    assert "phase 4: base_branch `phase-3` is not a same-repo" in msgs, msgs
    good = [{"phase": 1, "title": "a", "tags": [], "repo": "rohan_api", "base_branch": "base",
             "depends_on": [], "files": ["src/a.ts"], "verification": ["npm run lint"]}]
    assert check_meta(good) == [], check_meta(good)
    print("selftest ok")


def main():
    if "--selftest" in sys.argv:
        return selftest()
    plan = Path(sys.argv[1]).resolve()
    root = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else plan.parent
    text = plan.read_text()
    phases = parse_phases(text)
    if not phases:
        add("BLOCKER", "no ```phase-meta blocks found — run-plan cannot parse this plan")
    findings.extend(check_meta(phases))
    check_files(root, phases)
    check_verification(root, phases)
    check_contracts(text, phases, plan.with_name(plan.name.replace("-PLAN.md", "-contracts.md")))
    check_sections(text, phases)

    order = {"BLOCKER": 0, "MAJOR": 1, "MINOR": 2, "INFO": 3}
    for sev, msg in sorted(findings, key=lambda f: order[f[0]]):
        print(f"{sev}: {msg}")
    counts = {s: sum(1 for f in findings if f[0] == s) for s in order}
    print(f"\n{len(phases)} phases checked — " + ", ".join(f"{v} {k.lower()}" for k, v in counts.items()))
    sys.exit(1 if counts["BLOCKER"] else 0)


if __name__ == "__main__":
    main()
