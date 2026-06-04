# Lessons Learned

## Harness SAT Account Extraction
- **Issue**: Service account tokens can use the same account-scoped segment shape as PATs, but the parser only recognized the `pat` prefix.
- **Fix**: Extract account IDs from both `pat` and `sat` prefixes, and let multi-user HTTP sessions derive `HARNESS_ACCOUNT_ID` from either prefix when `x-harness-account-id` is omitted.
- **Rule**: Before requiring explicit account IDs for new Harness API key types, check whether the token format embeds the account ID segment; preserve explicit account overrides and mismatch validation.

## MCP SDK v1.27+ Type Compatibility
- **Issue**: `server.tool()` callback return type requires `[key: string]: unknown` index signature on the result object.
- **Fix**: Add `[key: string]: unknown` to the ToolResult interface.
- **Rule**: Always check MCP SDK type expectations for return types before defining custom interfaces.

## MCP SDK Prompt API
- **Issue**: `server.prompt()` does NOT accept an array of `{ name, description, required }` for args. It uses a Zod schema object.
- **Fix**: Use `{ paramName: z.string().describe("...").optional() }` format for prompt argument schemas.
- **Rule**: Check the actual SDK `.d.ts` types, not just documentation examples that may be outdated.

## Harness Artifact Registry (HAR) BuildAndPush Step
- **Issue**: HAR uses a different spec shape than third-party Docker registries in `BuildAndPushDockerRegistry` steps. Initially assumed HAR just swaps `connectorRef` to `account.harnessImage` — wrong.
- **Correct HAR spec**: Uses `registryRef` (NOT `connectorRef`). There is NO `connectorRef` at all. `repo` and `registryRef` are both typically `<+input>`.
- **Correct third-party spec**: Uses `connectorRef` (NOT `registryRef`). There is NO `registryRef`.
- **Rule**: HAR and third-party Docker registries are the same step type (`BuildAndPushDockerRegistry`) but mutually exclusive field sets: `registryRef` for HAR, `connectorRef` for third-party. Never mix them.

## LLM Prompt Reliability: Use Exact YAML Templates, Not Prose
- **Issue**: Prose instructions like "use registryRef instead of connectorRef" are unreliable — LLMs still mix up fields ~50% of the time.
- **Fix**: Embed exact copy-paste YAML templates (labeled TEMPLATE A / TEMPLATE B) directly in prompts. LLMs reliably copy from concrete examples.
- **Rule**: When a prompt needs the LLM to generate YAML with variant configurations, always provide the complete YAML snippet for each variant. Prose descriptions of field differences are insufficient.

## Chaos API Base Path
- **Issue**: Chaos toolset previously returned HTTP 404 for all requests (experiments, probes, infrastructures) across projects.
- **History**: The `/gateway` prefix was originally required but has since been removed. The correct base path is now `/chaos/manager/api`.
- **Fix**: Use `/chaos/manager/api` as the chaos API base path.
- **Rule**: When adding new Harness module toolsets, verify the API base path. Modules such as SEI and log-service use `/gateway/` prefix; chaos, ng, pipeline, code, cf, etc. do not.

## Pagination Parity Testing (v1 vs v2)
- **Methodology**: Use the same scope for both v1 and v2 (either both account-level OR both project-level). Compare the first element of page 2 from v1 with the first element of page 2 from v2.
- **Pass criteria**: If the first element of page 2 matches across both servers → pagination parity ✓
- **Fail criteria**: If they differ (same scope) → investigate (API params, sort order, date filters, etc.)
- **Rule**: Apply this pattern to all tools when testing pagination across MCP v1 and v2.

---

# New Resource Type Checklist (PR #296 retrospective)

PR #296 (FME identity/segment/traffic-type tools) needed **~11 follow-up commits, almost all pushed by the reviewers (Rohan + Cursor agent), not the original author**, to get compliant. Every finding was a *consistency gap* between three surfaces that must always agree: **(1) the runtime bodyBuilder/dispatch, (2) the agent-facing schema/metadata exposed by `harness_describe`, and (3) the human docs (README).** None were logic bugs — they were contract drift. Run this checklist BEFORE opening a PR that adds or edits a resource type.

## The exact compliance commits reviewers had to push (what we should have shipped first time)
| Commit | What it fixed | Checklist item it maps to |
|---|---|---|
| `953f7449` test: cover fme request body construction | Added the missing happy-path + first body-construction tests | "Fail loud locally" tests |
| `8b625f05` fix: tighten fme request guidance and uploads | `traffic_type_id` description pointed at `fme_workspace` → `fme_traffic_type`; `fme_segment_keys.update` empty-keys guard | Description source + fail-loud |
| `98ec8f23` fix: address PR 296 review follow-ups | Aligned `fme_workspace` description with list-only (405) reality; restored README CRUD columns; dropped agent notes from todo | PR-prose-vs-registry + README contract |
| `77f4ed1e` fix: refresh pr 296 docs against main | Regenerated counts/docs after main drift | README count parity |
| `34620717` fix: tighten fme segment docs and validation | Added the 4 new rows to the README FF table; hardened `generate-docs.js` with `README_COVERAGE_TOOLSETS` (row + toolset coverage) | README is part of the contract |
| `c307fd0d` fix: align fme docs contract with registry | Extended `generate-docs.js` to validate **per-operation column drift** and stale/nonexistent rows, not just presence | README operation-column drift |
| `d1df29f1` fix: align fme request metadata contracts | Added `listFilterFields` to `fme_traffic_type`/`fme_standard_segment`/`fme_segment_keys`; made empty-write guards reject non-object bodies; narrowed `add`-only contract | pathParams↔listFilterFields + structured required |
| `92d53a3d` fix: map execute resource ids to action path targets | Rewrote `harness-execute.ts` `resource_id` mapping to target the action's own `pathParams` (fixed enable/disable on segment defs) + regression test | harness_execute id mapping |

**Takeaway: 8 of these are pure contract-consistency fixes a single pre-PR self-review pass would have caught.** The reviewers did our work. The checklist below is exactly that self-review pass.

## The Three-Surface Rule (root cause of every PR #296 finding)
For any resource operation, these three MUST tell the same story:
1. **Runtime** — what `bodyBuilder` / `pathParams` / `Registry.dispatch` actually require and send.
2. **Contract metadata** — `bodySchema.fields[].required`, `listFilterFields`, `identifierFields` (this is what `harness_describe` shows the agent).
3. **Docs** — README resource table (per-operation columns), toolset filtering list, prose descriptions, and the count.

If you change one, grep the other two in the same edit. A runtime guard with no matching schema `required: true` is a defect, not a safety net.

## The escalation pattern (why it took 7 rounds, not 1)
The review came in **7 waves over ~2 hours**, and several findings were *fixes to the previous round's fix*:
- Round 1: "add a fail-loud guard for empty `items`/`add`." → Round 3: "your guard reads `body.add` before checking `body` exists, so a *missing* body throws `TypeError` instead of the structured error." The fix introduced a new bug.
- Round 5: "extend `docs:check` to verify the new rows exist." → Round 6: "your new check only verifies *presence*; it still passes while the matrix shows wrong operation columns and lists a nonexistent `feature_flag` resource." The validator was too shallow.
- Round 6/7: "reordering `identifierFields` fixed get/update/delete." → "...but `harness_execute` uses *different* mapping logic; enable/disable are still broken." A fix on one code path left the parallel path broken.
- **Lesson: when you add a guard/validator/mapping, immediately enumerate (a) the adjacent failure cases of your own new code (missing vs empty vs wrong-type), (b) every parallel code path with the same responsibility, and (c) whether the check is deep enough to catch the actual drift — not just presence.** Fixing narrowly invites a second round on the same line.

## Checklist
- [ ] **Required inputs live in structured metadata, not just runtime throws.** If `bodyBuilder` throws when a field is missing/empty, that field MUST be `required: true` in `bodySchema.fields`. Agents only see the schema via `harness_describe`; a runtime-only guard means they learn the contract from a failed call. (PR #296: `fme_identity.items` and `fme_segment_keys.add` threw but were `required: false`.)
- [ ] **Every `pathParams` field has a matching `listFilterFields` / identifier entry.** If `list` hard-requires `workspace_id` via `pathParams`, `harness_describe` must expose `workspace_id` as a required list filter — otherwise discovery shows no inputs but dispatch fails locally. (PR #296: `fme_traffic_type` list required `workspace_id` with no `listFilterFields`.)
- [ ] **Don't relax the shared validator for one resource.** Skipping `bodySchema` validation "for array payloads" in `Registry` silently weakened the contract for *every* array-body resource and let `harness_create`/`harness_update` accept undocumented shapes. Keep the public contract object-shaped (`{items:[...]}`, `{add:[...]}`) and validate it; if you must accept raw arrays, widen the generic tool layer too — don't carve a hole only reachable via direct `dispatch()`. (PR #296: `src/registry/index.ts:691` array-skip.)
- [ ] **`harness_execute` maps `resource_id` differently than get/update/delete.** Reordering `identifierFields` fixes the get/update/delete path (they map `resource_id` → last field) but NOT execute. `harness-execute.ts` maps `resource_id` to the action's own `pathParams` target. If an execute action's path omits the parent identifier (e.g. `enable`/`disable` on a segment definition use `{environmentId}/{segmentName}`, no `workspace_id`), verify `harness_execute(resource_id=...)` actually reaches the right field — and add a tool-handler regression test. (PR #296: enable/disable returned `Missing required field "segment_name"`.)
- [ ] **Descriptions must point at the resource that actually provides the value.** "get `traffic_type_id` from `fme_workspace`" was wrong — the new `fme_traffic_type` resource provides it. Tool/param descriptions are the agent-facing contract; cross-references must name the real source resource.
- [ ] **README is part of the contract (CONTRIBUTING requires it).** `docs:check` originally only validated *counts*, so new resources bumped 206→207 but never appeared in the Feature Flags table or toolset list. Add the per-operation row AND the toolset-filtering entry. PR #296 hardened `generate-docs.js` with a `README_COVERAGE_TOOLSETS` set that validates resource-row presence + toolset coverage for touched toolsets — extend that set when normalizing a new toolset's tables.
- [ ] **Fail loud locally, never send empty writes — and guard the guard.** Write bodyBuilders must reject empty payloads (`[]`, `{}`, `{add:[]}`) before dispatch with a clear message, not send a no-op request to the API. **Check `body` type/existence BEFORE indexing into it** — `record.add` on an undefined body throws `TypeError`, not your nice validation error. Cover ALL of: missing body, wrong-type body (array when object expected), and empty-collection body — each with a regression test asserting the structured throw. (PR #296 shipped the guard in round 1, then needed round 3 to fix the missing-body `TypeError` the guard itself introduced.)
- [ ] **Resource-level `description` must not overstate the operation contract.** `harness_describe` surfaces the resource description to agents. `fme_segment_keys` said updates "add/remove members" but the endpoint is add-only (removal needs the UI) — that encourages agents to attempt unsupported operations. Keep the resource description, the operation description, and the actual API capability in lockstep.
- [ ] **A docs/coverage validator must check depth, not just presence.** When you harden `generate-docs.js` to enforce README parity, verify it catches *operation-column drift* (table says get-only but registry has create/update) and *stale/nonexistent rows* (table lists a resource the registry no longer has) — not merely that a row with the right name exists. A presence-only check passes on a wrong table. (PR #296 needed two rounds on this exact script.)
- [ ] **PR description must match the merged registry.** PR #296 body claimed `fme_workspace`/`fme_environment` gained `get`, but live validation (HTTP 405) made them list-only and the code reflected list-only. Reconcile PR prose with `supportsOperation(...)` reality before requesting review.

## Process lesson
- **Verify against the live PR head, not the local branch.** PR #296's `origin` ref lagged the actual PR head by 6 commits (reviewers + Cursor agent were pushing fixes directly). Before analyzing or "fixing" review feedback, `gh pr view <n> --json headRefOid` and fetch that exact sha — otherwise you re-solve already-solved findings or miss new ones.
- **For new resource types, dispatch a self-review against this checklist before opening the PR.** Each bullet here was a separate review round that a reviewer had to catch and push a fix for. Catching them in one pass is the difference between a clean merge and 6 rounds of reviewer rework.
