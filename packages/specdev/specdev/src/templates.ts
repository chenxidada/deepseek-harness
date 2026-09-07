/**
 * Minimal SpecDev workspace templates copied into a new `.specdev` layout.
 *
 * @module @deepseek-ai/dsh-specdev/templates
 */

/** Default constitution.md body for a new SpecDev workspace. */
export const CONSTITUTION_TEMPLATE = `# Project Constitution

This document defines non-negotiable constraints for SpecDev agents.

## Code quality

1. No empty shell functions — exported APIs must contain real logic.
2. Each Phase needs at least one integration test on a real data path.
3. Stubs must use \`@STUB(phase-N)\` and be registered in \`tech-debt-registry.md\`.

## Process

1. Human Gates (HG-1 / HG-2 / HG-3) are mandatory stops.
2. \`confirmGate\` is the sole path that may set \`human_gates.*.passed\`.
3. Phase ids must match \`phase-plan.md\` DAG JSON \`phases[].id\`.
`

/** Default tech-debt-registry.md body for a new SpecDev workflow slug. */
export const TECH_DEBT_REGISTRY_TEMPLATE = `# Tech Debt Registry

> Single source of truth for known stubs and gaps in this workflow.

---

## Active

| ID | Source Phase | Module | Location | Current | Expected | Type | Tags | Dependents | Target Phase | Blocking | Source | Registered |
|----|:------------:|--------|----------|---------|----------|------|------|------------|:------------:|:--------:|--------|------------|
| — | — | — | — | — | — | — | — | — | — | — | — | — |

## Resolved

| ID | Source Phase | Description | Resolved Phase | Date | Verification |
|----|:------------:|-------------|----------------|------|--------------|
| — | — | — | — | — | — |
`
