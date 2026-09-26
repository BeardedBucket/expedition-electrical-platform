# Agent Guide

## Project context

This repository is an engineering configurator for mobile and off-grid electrical systems. Read `PROJECT_CHARTER.md` and `docs/ARCHITECTURE.md` before changing architecture or engineering behavior. Consult `docs/RATING_AND_ADVISORY_POLICY.md` and `docs/LICENSE_POLICY.md` when work touches their subjects. Keep the platform voltage agnostic and manufacturer neutral: a reference build, product, vehicle, or builder must not become a general default. Preserve the boundary between the deterministic engineering core, product data, advisories, builder overlays, and UI presentation.

## Repository workflow

Work in the provided branch and worktree. Do not autonomously create or switch branches. Do not stage, commit, push, merge, create a pull request, or change repository permissions unless the user explicitly requests that action. Preserve pre-existing local and untracked files unless the task explicitly authorizes modifying them. Keep changes within the requested scope and inspect the diff before handing off.

On Windows PowerShell, invoke npm as `npm.cmd`. Run npm validation commands sequentially, never concurrently. Use focused validation for the code, rules, or data changed. For full, release, or pull-request validation, follow `CONTRIBUTING.md` and the repository scripts rather than maintaining a command list here. Do not run broad write-mode formatters across unrelated files.

## Engineering and product facts

Keep engineering functions deterministic and separate from UI presentation. The same inputs with the same rule and data versions must produce the same results. Use explicit units, assumptions, and conversions; make calculations reproducible and explainable. Declare relevant electrical and physical assumptions at their boundaries. Put standards-derived values in versioned, source-attributed data rather than burying them in code. Add tests for calculation and engineering-rule boundaries, including positive and negative cases.

Treat serviceability and installation constraints, including access, ventilation, disconnect placement, and cable routing, as engineering inputs where applicable. Keep rules human-readable and versioned, with their source or project rationale available for review. Expose the assumptions and evidence behind an output so a reviewer can reproduce the decision and identify where a human judgment is still required.

Never fabricate manufacturer specifications, standards values, evidence, safety findings, or missing data. Unless a governing contract explicitly defines otherwise, absent or missing data means unknown, unmodeled, or not asserted; do not silently convert it to false, zero, empty, unsupported, nonexistent, or incompatible. Keep manufacturer or source facts distinguishable from derived and calculated values. Preserve source locators and provenance for factual product data. Prefer official sources for components, and keep machine- or AI-extracted claims as provisional, unverified evidence until the applicable review process establishes their reviewed status. An extracted claim is a reviewable proposal, not a verified fact.

Engineering compatibility and safety constraints precede builder inventory, vendor, commercial, and preference filtering. Those later filters can narrow eligible choices but cannot make an unsafe or incompatible product eligible. Preserve a clear explanation of recommendations, warnings, and unresolved fit. Keep advisories distinct from ratings and recommendation scores; an active advisory must remain visible, and required human review cannot be replaced by an automated confidence or ranking result.

## Third-party material

Respect `docs/LICENSE_POLICY.md`. Link third-party CAD, drawings, datasheets, and other restricted assets rather than copying them into the repository unless redistribution rights are documented. Record the required source and license metadata for any permitted import. Do not reproduce copyrighted standards material without confirming its allowed use.
