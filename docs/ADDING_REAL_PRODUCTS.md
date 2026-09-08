# Adding real products safely

1. Define the exact manufacturer identity and select the applicable reviewed acquisition profile.
2. Capture the primary source and retain its retrieval metadata and content hash.
3. Acquire structured or inert source evidence, normalize only through the existing field registry, and persist the candidate facts with source IDs.
4. Prepare a review artifact. A human must approve the candidate, fields, evidence, and candidate snapshot; extraction never approves facts.
5. Run the corpus workflow with the approved review. New identities use the create-only canonical writer; existing identities require a reviewed amendment.
6. Run `npm.cmd run validate:data`, the focused ingestion tests, and the full repository validation.

The reusable orchestration API is `assessCorpusWorkflow` / `executeCorpusWorkflow` in `packages/ingestion/src/corpus-workflow.ts`. Coordination-only work items live under `data/ingestion/corpus-work-items/`; they contain selectors and artifact paths, not engineering facts.
