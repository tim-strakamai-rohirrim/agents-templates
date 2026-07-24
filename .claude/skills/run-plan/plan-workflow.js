export const meta = {
  name: 'run-plan-phases',
  description: 'Drive a phased PLAN.md to draft PRs: implement, review gate, draft PR, and AI (bot) review cycle per phase. The 3-sided stack review runs afterward in the main loop via the review-stack-3-sided skill.',
  phases: [
    { title: 'Implement', detail: 'one implementer agent per ready phase' },
    { title: 'Review', detail: 'plan-compliance + security reviewers with fix loop' },
    { title: 'PR', detail: 'draft PR, dep-cycle join, merge propagation (no force-push)' },
    { title: 'AI Review', detail: 'CodeRabbit + Copilot cycle, PR stays draft' },
  ],
}

// Invoked by the run-plan skill (see SKILL.md in this directory). Expects args:
// {
//   ticket: 'ROH-1234',
//   gitUser: 'tstraka',                  // branch prefix: {gitUser}/{ticket}/phase-{N}
//   workspaceRoot: '/abs/path/to/rohan',
//   baseBranch: 'main',                  // what phase-meta `base_branch: base` resolves to
//   repoPaths: {
//     rohan_api: 'rohan_api-parent/rohan_api',
//     rohan_ui: 'rohan_ui-parent/rohan_ui',
//     rohan_python_api: 'rohan-python-api',
//     onering: 'ONERING',
//   },
//   maxFixRounds: 2,
//   skipAiReview: false,
//   phases: [{ phase, title, repo, base_branch, depends_on: [], files: [], contracts: [],
//              verification: [], status: 'merged'|'pr-open'|'branch-exists'|'not-started' }],
// }

// Some Workflow runtimes deliver `args` as a JSON string rather than a parsed
// object; destructuring a string silently yields undefined fields (which then
// blows up at `allPhases.filter`). Normalize to an object before reading.
const _A = typeof args === 'string' ? JSON.parse(args) : (args || {})
const { ticket, gitUser, workspaceRoot, baseBranch, repoPaths } = _A
const maxFixRounds = _A.maxFixRounds || 2
const allPhases = _A.phases

const branchOf = (n) => `${gitUser}/${ticket}/phase-${n}`
// Resolve a phase's base ref:
//   'base'      → the repo's real base branch (the baseBranch arg, e.g. main)
//   'phase-N'   → the ticket-scoped stacked branch {user}/{ticket}/phase-N
//   anything else ('main', 'develop', …) → that literal branch name
// Only `phase-N` refs get ticket-scoped; a real branch name stays itself, so
// `base_branch: main` bases off main (not a stale {user}/{ticket}/main snapshot).
const baseRefOf = (p) =>
  p.base_branch === 'base'
    ? baseBranch
    : /^phase-\d+$/.test(p.base_branch)
      ? `${gitUser}/${ticket}/${p.base_branch}`
      : p.base_branch
const repoPathOf = (p) => `${workspaceRoot}/${repoPaths[p.repo]}`
const repoNameOf = (p) => repoPaths[p.repo].split('/').pop()

// ---------------------------------------------------------------------------
// Structured-output schemas — sub-agent reports are validated, never parsed
// from prose.
// ---------------------------------------------------------------------------

const IMPL_REPORT = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    branch: { type: 'string' },
    worktree_path: { type: 'string', description: 'Absolute path if work happened in a dedicated worktree, else empty' },
    steps_completed: { type: 'array', items: { type: 'string' } },
    files_changed: { type: 'array', items: { type: 'string' } },
    verification: {
      type: 'array',
      items: {
        type: 'object',
        properties: { command: { type: 'string' }, passed: { type: 'boolean' } },
        required: ['command', 'passed'],
      },
    },
    issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['success', 'branch', 'verification'],
}

const REVIEW_VERDICT = {
  type: 'object',
  properties: {
    verdict: { enum: ['PASS', 'FAIL'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] },
          file: { type: 'string' },
          description: { type: 'string' },
          remediation: { type: 'string' },
        },
        required: ['severity', 'description'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['verdict', 'findings', 'summary'],
}

const PR_RESULT = {
  type: 'object',
  properties: {
    pr_number: { type: 'number' },
    pr_url: { type: 'string' },
    base_branch: { type: 'string' },
    is_draft: { type: 'boolean' },
    dep_merge_performed: { type: 'boolean' },
  },
  required: ['pr_number', 'pr_url', 'is_draft'],
}

const CYCLE_REPORT = {
  type: 'object',
  properties: {
    rounds: { type: 'number' },
    fixed: { type: 'number' },
    pushed_back: { type: 'number' },
    pushed_commits: { type: 'array', items: { type: 'string' } },
    still_draft: { type: 'boolean' },
    notes: { type: 'string' },
  },
  required: ['rounds', 'pushed_commits', 'still_draft'],
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

function worktreeNote(p) {
  const env = p.repo === 'rohan_api'
    ? `\nThis is a rohan_api worktree — .env, .env.test, and scripts/add_user_local.sql are gitignored and missing. Copy them from the primary checkout per .claude/skills/copy-rohan-api-worktree-files/SKILL.md before running verification.`
    : ''
  return `
IMPORTANT — another agent is using this repo's primary checkout concurrently. Do NOT switch branches or edit files in the primary checkout. Create a dedicated worktree and do ALL work inside it:

  cd ${repoPathOf(p)}
  git worktree add ../${repoNameOf(p)}-${ticket}-phase-${p.phase} -b ${branchOf(p.phase)} ${baseRefOf(p)}
${env}
Leave the worktree in place when done (later steps push from it) and report its absolute path as worktree_path.`
}

function implementPrompt(p, useWorktree) {
  return `You are implementing phase ${p.phase} of ticket ${ticket}.

Read .claude/skills/implement-phase/SKILL.md (relative to ${workspaceRoot}) and follow its complete workflow for this phase.

Context:
- Ticket: ${ticket}
- Phase: ${p.phase} — ${p.title}
- Plan: ${workspaceRoot}/${ticket}-PLAN.md
- Contracts: ${workspaceRoot}/${ticket}-contracts.md
- Repo path: ${repoPathOf(p)}
- Branch: ${branchOf(p.phase)} (base: ${baseRefOf(p)})
- Git user for branch naming: ${gitUser}
${useWorktree ? worktreeNote(p) : ''}
Follow every step: load context, read contracts, verify prerequisites, set up the branch, read existing code, implement all steps, run every verification command until green, and commit. Do NOT push — PR creation handles that.

Do NOT reference the plan or contracts docs in code comments (the plan is not generally accessible, so such references are dead links to readers). Comments should explain intent and non-obvious logic on their own terms.

Your final report is consumed programmatically by an orchestration script, not read by a human.`
}

function reviewContext(p) {
  return `- Ticket: ${ticket}, phase ${p.phase} — ${p.title}
- Plan: ${workspaceRoot}/${ticket}-PLAN.md (this phase's section and its context summary)
- Contracts: ${workspaceRoot}/${ticket}-contracts.md (sections: ${(p.contracts || []).join(', ') || 'see plan'})
- Repo: ${repoPathOf(p)}
- Diff to review: run \`git diff ${baseRefOf(p)}...${branchOf(p.phase)}\` in that repo.`
}

function rereviewNote(priorFindings, fixSummary) {
  if (!priorFindings) return ''
  return `

A previous review round raised the findings below, and a fix agent has since committed changes. For EACH original finding, verify it is actually resolved in the current diff — do not take the fix report's word for it. Report any finding that is still open, plus any regression the fix introduced.

Original findings:
${JSON.stringify(priorFindings, null, 2)}

Fix agent's report:
${fixSummary}`
}

function compliancePrompt(p, priorFindings, fixSummary) {
  return `Review phase ${p.phase} of ticket ${ticket} for plan and contract compliance.

${reviewContext(p)}

Check the diff against the phase's step checklist and the contract specifications — exact DTOs, field names, error strings, endpoint shapes, status codes. Verdict FAIL if any acceptance criterion or contract is violated; report each violation as a finding (contract violations are HIGH).${rereviewNote(priorFindings, fixSummary)}`
}

function securityPrompt(p, priorFindings, fixSummary) {
  return `Security-review phase ${p.phase} of ticket ${ticket} (${p.repo} repository).

${reviewContext(p)}

Analyze the diff for vulnerabilities: injection, auth/RBAC bypasses, secret leakage, unsafe deserialization, SSRF, path traversal. Verdict FAIL only if CRITICAL or HIGH findings exist; report MEDIUM/LOW as findings with a PASS verdict.${rereviewNote(priorFindings, fixSummary)}`
}

function fixPrompt(p, findings, implReport) {
  return `Fix review findings on phase ${p.phase} of ticket ${ticket}.

- Repo: ${repoPathOf(p)}${implReport && implReport.worktree_path ? ` (work in the worktree at ${implReport.worktree_path})` : ''}
- Branch: ${branchOf(p.phase)} (check it out if not already)
- Contracts: ${workspaceRoot}/${ticket}-contracts.md

Findings to fix (from plan-compliance and security reviewers):
${JSON.stringify(findings, null, 2)}

Fix every finding, re-run this phase's verification commands until green (${(p.verification || []).join(' && ') || 'repo lint + tests'}), and commit. Do not push. Report what you changed per finding.

Do NOT reference the plan or contracts docs in code comments (the plan is not generally accessible); keep comments focused on intent and non-obvious logic.`
}

function prPrompt(p, reviews, depMerges, implReport) {
  const mergeNote = depMerges.length
    ? `

BEFORE pushing — propagate stacked-branch updates: the AI review cycle pushed commits to dependency branch(es) after this phase branched off them. For each one below, run in ${repoPathOf(p)} (use the phase worktree if one is reported) on ${branchOf(p.phase)}:

  git fetch origin && git merge origin/<dep-branch>

Use a MERGE COMMIT — never rebase, never force-push (force-push is denied in this workspace). Resolve any conflicts and re-run this phase's verification commands before pushing.

Dependency updates: ${JSON.stringify(depMerges)}`
    : ''
  return `Create a GitHub pull request for phase ${p.phase} of ticket ${ticket}.

Read .claude/skills/create-pr/SKILL.md (relative to ${workspaceRoot}) and follow its workflow. SKIP its review gate — reviews already ran; include these results in the PR body instead:
- Plan compliance: ${reviews.compliance ? reviews.compliance.summary : 'not run'}
- Security: ${reviews.security ? reviews.security.summary : 'not run'}

Context:
- Plan: ${workspaceRoot}/${ticket}-PLAN.md, contracts: ${workspaceRoot}/${ticket}-contracts.md
- Repo path: ${repoPathOf(p)}${implReport && implReport.worktree_path ? ` (branch lives in worktree ${implReport.worktree_path})` : ''}
- Branch: ${branchOf(p.phase)}, base: ${baseRefOf(p)}
${mergeNote}

The PR MUST be created as a DRAFT and left in draft.`
}

function cyclePrompt(p, pr) {
  const env = p.repo === 'rohan_api'
    ? ` For rohan_api, copy .env/.env.test/scripts/add_user_local.sql from the primary per .claude/skills/copy-rohan-api-worktree-files/SKILL.md.`
    : ''
  return `Run the AI review cycle for PR #${pr.pr_number} (${ticket} phase ${p.phase}).

Read .claude/skills/pr-ai-review-cycle/SKILL.md (relative to ${workspaceRoot}) and follow its complete workflow.

Inputs:
- pr_number: ${pr.pr_number}
- PR URL: ${pr.pr_url} (derive the {owner}/{repo} slug from this)
- max_loops: 2

Working-tree isolation — this cycle runs CONCURRENTLY with later phases implementing in ${repoPathOf(p)}. Never switch branches in the primary checkout. Before any fix work, create a dedicated worktree:

  cd ${repoPathOf(p)}
  git worktree add ../${repoNameOf(p)}-${ticket}-phase-${p.phase}-cycle ${branchOf(p.phase)}
${env}
Do all fix work there and remove the worktree when the cycle ends (git worktree remove --force <path> after pushing).

Scope guard — only touch files in this phase's list: ${JSON.stringify(p.files)}. If a bot asks for changes spanning other phases, push back as out-of-scope rather than editing files another phase owns. Never force-push; append commits only.

The PR is and must remain a DRAFT for the entire cycle. Report rounds run, comments fixed/pushed back, every commit SHA you pushed, and the final draft state.`
}

// Per-PR bot review cycle (CodeRabbit/Copilot). Runs concurrently with later
// waves; its pushed_commits feed stacked-branch merge propagation at the
// dependents' PR-creation step. The 3-sided review is NOT done here — it runs
// stack-aware and bottom-up AFTER the workflow, via the review-stack-3-sided
// skill invoked from the run-plan main loop (see run-plan SKILL.md).
async function postPrReviews(p, pr) {
  const label = `phase-${p.phase}`
  if (_A.skipAiReview) {
    return { pushed_commits: [], still_draft: true, bot_cycle: null }
  }
  const bot = await agent(cyclePrompt(p, pr), {
    label: `ai-cycle:${label}`, phase: 'AI Review', schema: CYCLE_REPORT,
  })
  return {
    pushed_commits: bot ? bot.pushed_commits || [] : [],
    still_draft: bot ? bot.still_draft : true,
    bot_cycle: bot,
  }
}

// ---------------------------------------------------------------------------
// Phase execution
// ---------------------------------------------------------------------------

function blockingFindings(reviews) {
  const out = []
  if (reviews.compliance && reviews.compliance.verdict === 'FAIL') {
    out.push(...reviews.compliance.findings.map((f) => ({ source: 'plan-compliance', ...f })))
  }
  if (reviews.security) {
    out.push(...reviews.security.findings
      .filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH')
      .map((f) => ({ source: 'security', ...f })))
  }
  return out
}

const cycleJoin = {} // phase number -> in-flight promise of the postPrReviews chain (never awaited at spawn)

async function runPhase(p, useWorktree) {
  const label = `phase-${p.phase}`

  // Join early: if a dependency's AI review cycle is still in flight and this
  // phase touches the same files in the same repo, its bot-fix commits would
  // race our implementation. Wait for that cycle before implementing.
  for (const d of p.depends_on || []) {
    const dep = allPhases.find((x) => x.phase === d)
    if (!dep || !cycleJoin[d]) continue
    const overlap = dep.repo === p.repo && (dep.files || []).some((f) => (p.files || []).includes(f))
    if (overlap) {
      log(`Phase ${p.phase} shares files with phase ${d} — waiting for its AI review cycle before implementing`)
      await cycleJoin[d]
    }
  }

  // 1. Implement (skipped when the branch already exists from a prior run)
  let impl = null
  if (p.status !== 'branch-exists') {
    impl = await agent(implementPrompt(p, useWorktree), {
      label: `implement:${label}`, phase: 'Implement', schema: IMPL_REPORT,
    })
    if (!impl || !impl.success) {
      log(`Phase ${p.phase} implementation FAILED — dependents will not run`)
      return { phase: p.phase, title: p.title, status: 'implementation-failed', impl }
    }
  }

  // 2. Review gate with fix loop. Re-review rounds carry the original findings
  //    forward so reviewers verify their own findings are resolved (the
  //    workflow-context equivalent of continuing the reviewer via SendMessage).
  let reviews = {}
  let priorFindings = null
  let fixSummary = null
  let blocking = []
  for (let round = 0; round <= maxFixRounds; round++) {
    const [compliance, security] = await parallel([
      () => agent(compliancePrompt(p, priorFindings, fixSummary), {
        label: `review:plan:${label}`, phase: 'Review', schema: REVIEW_VERDICT,
        agentType: 'plan-compliance-reviewer',
      }),
      () => agent(securityPrompt(p, priorFindings, fixSummary), {
        label: `review:security:${label}`, phase: 'Review', schema: REVIEW_VERDICT,
        agentType: 'security-reviewer',
      }),
    ])
    reviews = { compliance, security }
    blocking = blockingFindings(reviews)
    if (!blocking.length || round === maxFixRounds) break
    log(`Phase ${p.phase}: ${blocking.length} blocking finding(s) — fix round ${round + 1}/${maxFixRounds}`)
    fixSummary = await agent(fixPrompt(p, blocking, impl), { label: `fix:${label}`, phase: 'Review' })
    priorFindings = blocking
  }
  if (blocking.length) {
    log(`Phase ${p.phase} still has ${blocking.length} blocking finding(s) after ${maxFixRounds} fix round(s) — stopping this chain`)
    return { phase: p.phase, title: p.title, status: 'review-blocked', findings: blocking, reviews }
  }

  // 3. Join dependency AI review cycles before opening this PR, and collect
  //    any commits they pushed so the PR agent can merge them in (no rebase,
  //    no force-push — stacked updates propagate via merge commits).
  const depMerges = []
  for (const d of p.depends_on || []) {
    if (!cycleJoin[d]) continue
    const rep = await cycleJoin[d]
    if (rep && rep.pushed_commits && rep.pushed_commits.length) {
      depMerges.push({ dep_branch: branchOf(d), commits: rep.pushed_commits })
    }
  }

  // 4. Create the draft PR
  const pr = await agent(prPrompt(p, reviews, depMerges, impl), {
    label: `pr:${label}`, phase: 'PR', schema: PR_RESULT,
  })
  if (!pr) {
    return { phase: p.phase, title: p.title, status: 'pr-failed', reviews }
  }

  // 5. Kick off the per-PR bot review cycle WITHOUT awaiting — it overlaps
  //    with the next wave's implementation. Joined at step 3 of dependents and
  //    at the end of the run; its pushed_commits drive stacked-branch merge
  //    propagation. The 3-sided stack review happens after the whole workflow.
  if (!_A.skipAiReview) {
    cycleJoin[p.phase] = postPrReviews(p, pr)
  }

  const mediumNotes = (reviews.security ? reviews.security.findings : [])
    .filter((f) => f.severity === 'MEDIUM' || f.severity === 'LOW')
  return { phase: p.phase, title: p.title, status: 'pr-created', pr, non_blocking_findings: mediumNotes }
}

// ---------------------------------------------------------------------------
// Wave scheduler — dependency-gated, deterministic
// ---------------------------------------------------------------------------

const completed = new Set(allPhases.filter((p) => p.status === 'merged' || p.status === 'pr-open').map((p) => p.phase))
let pending = allPhases.filter((p) => !completed.has(p.phase))
const results = []

if (!pending.length) log('All phases are already merged or have open PRs — nothing to do.')

while (pending.length) {
  const ready = pending.filter((p) => (p.depends_on || []).every((d) => completed.has(d)))
  if (!ready.length) {
    log(`Blocked: phase(s) ${pending.map((p) => p.phase).join(', ')} have incomplete dependencies — stopping.`)
    break
  }
  log(`Wave: phase(s) ${ready.map((p) => p.phase).join(', ')}`)

  // Same-repo phases in one wave contend for the primary checkout: the first
  // gets it, the rest get dedicated nested-repo worktrees.
  const repoSeen = {}
  const wave = await parallel(ready.map((p) => {
    const useWorktree = Boolean(repoSeen[p.repo])
    repoSeen[p.repo] = true
    return () => runPhase(p, useWorktree)
  }))

  for (const r of wave.filter(Boolean)) {
    results.push(r)
    if (r.status === 'pr-created') completed.add(r.phase)
  }
  const processed = new Set(ready.map((p) => p.phase))
  pending = pending.filter((p) => !processed.has(p.phase))
}

// Final join — wait for every still-running bot review cycle so the run ends
// with all PRs opened, bot-cycled, and still in draft. The 3-sided stack
// review runs next, in the main loop, via the review-stack-3-sided skill.
const cycles = {}
for (const num of Object.keys(cycleJoin)) {
  cycles[num] = await cycleJoin[num]
  if (cycles[num] && cycles[num].still_draft === false) {
    log(`WARNING: phase ${num} PR is no longer draft — someone flipped it mid-cycle`)
  }
}

return { ticket, phases: results, post_pr_reviews: cycles }
