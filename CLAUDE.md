# V31M4 Claude Operating Contract

```text
CONST PRIORITY := CORRECTNESS > COMPLETENESS > VERIFICATION > ARCHITECTURE > EFFICIENCY
INVARIANT := EFFICIENCY MUST_NOT weaken {CORRECTNESS, COMPLETENESS, VERIFICATION, ARCHITECTURE}

PROC START():
  READ("docs/current-state.md")
  VERIFY(git.branch, git.HEAD, git.status, git.diff, active_task)
  REQUIRE(repo_state == evidence_backed)
  NEVER infer what Git/repo can verify

CONST GOV := "AGENTS.md"
CONST SRC_ORDER :=
  repository-specification
  > architecture
  > accepted_ADRs
  > dependency-rules
  > state-model
  > domain_interfaces
  > application_ports
  > API_adapter_contracts
  > plugin_manifests
  > implementation
  > tests

PROC BEFORE_WRITE(target):
  FOLLOW(GOV)
  READ(required_source_docs_for(target))
  READ(nearest_module_README(target))
  VERIFY(owner_layer(target), dependency_direction(target), affected_invariants(target))
  IF implementation_conflicts_with_architecture => STOP + REPORT(conflict)

PROC CONTEXT(task):
  SEARCH(task) > broad_scan
  READ(minimum_sufficient_context)
  BATCH(related_searches, related_reads) WHEN clarity_preserved

  REREAD(file) IFF
    changed(file)
    OR failure_refs(file)
    OR contradiction(file)
    OR uncertainty(file)
    OR dependency_changed(file)
    OR invariant_affected(file)

  FORBID rediscovery(verified_unchanged_fact)
  FORBID full_repo_scan UNLESS task_or_impact_requires
  FORBID whole_file_dump WHEN targeted_excerpt_sufficient
  FORBID large_success_logs
  PRESERVE(errors, warnings, failures, required_evidence)

  IF sufficient_verified_evidence => IMPLEMENT
  IF new_uncertainty OR failure OR contradiction => INVESTIGATE

PROC REASON(task):
  DEPTH := adaptive(risk | uncertainty | complexity | blast_radius)
  STOP_ANALYSIS IFF sufficient_verified_evidence AND no_unresolved_material_risk
  ESCALATE IF architecture | security | persistence | recovery | cross_layer | novel_failure affected
  FORBID circular_analysis | repeated_reasoning_without_new_evidence
  NEVER cap required_reasoning_to_save_tokens

PROC ENGINEER(task):
  REQUIRE(outcome_known, acceptance_criteria_known)
  PREFER(existing_abstraction) OVER parallel_abstraction
  PREFER(root_cause_fix) OVER symptom_patch
  PRESERVE(verified_behavior) UNLESS requirement_changes_it
  CHECK(callers, dependencies, boundaries, invariants, failure_paths)
  FORBID(architecture_bypass, second_source_of_truth)
  FORBID weakening(types, tests, validation, security, determinism, recovery)
  REJECT cheaper_path IF result_quality_decreases

PROC IMPLEMENT(task):
  GROUP(related_work)
  APPLY(smallest_complete_correct_change)
  AUTOFIX(routine_compile | test | lint | migration | integration_failure)
  DO_NOT_PAUSE(for_routine_engineering_decisions)
  DO_NOT_RESTART(verified_completed_work)
  DO_NOT_REDESIGN(settled_architecture) UNLESS evidence_requires

PROC DEFECT(x):
  reproduce(x)
  classify(x)
  add_regression_test(x)
  fix(root_cause(x))
  focused_verify(x)
  rerun(affected_regression(x))

PROC VERIFY(change):
  DURING_WORK := focused_tests + relevant_static_checks
  CHECKPOINT := required_full_regression + typecheck + build + lint + architecture_dependency_gates
  RUN(broader_checks_early) IF cross_layer | shared_contract | persistence | security | recovery affected
  FORBID test_weakening_for_PASS
  CLAIM_COMPLETE IFF acceptance_criteria_met AND required_gates == PASS
  CLAIM_PASS IFF executed_evidence == PASS

PROC AGENTS(task):
  SPAWN IFF
    independent_verification(task)
    OR meaningful_parallelism(task)
    OR specialist_value(task)
    OR material_risk_reduction(task)
  FORBID(redundant_agent, duplicate_repo_discovery)

PROC GIT():
  VERIFY(branch) BEFORE writes
  canonical_current_contracts > superseded_reference_implementations
  reference_branch := behavioral_evidence_only
  FORBID compatibility_shim_for_obsolete_names
  FORBID merge | rebase | branch_delete | destructive_history_change UNLESS explicitly_authorized
  FORBID committing(temp | session | toolchain_scaffolding)

PROC HANDOFF():
  FILE := "docs/current-state.md"
  UPDATE IFF meaningful_checkpoint | branch_change | verified_completion | blocker | major_decision
  CONTENT := {branch, active_task, verified_complete, in_progress, blockers, last_gate, next_action}
  REPLACE(stale_state)
  FORBID(session_diary, duplicate_history, throwaway_handoff_file)
  Git_history := historical_record

STOP IFF
  genuine_architecture_decision_required
  OR destructive_action_needs_approval
  OR credential_or_permission_required
  OR irreconcilable_spec_conflict
  OR required_external_input_unavailable
ELSE CONTINUE_AUTONOMOUSLY

TOKEN_POLICY:
  SAVE := remove(redundant_work | rediscovery | narration | duplicate_search | unnecessary_history | redundant_agents | unnecessary_output)
  NEVER_SAVE := remove(required_reasoning | required_context | required_testing | required_verification | required_security_analysis)
  RULE := stronger_result > lower_token_count
```
