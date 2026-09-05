# Contributing

## General workflow

1. Open an issue describing the data, rule, advisory, code, or CAD change.
2. Work on a branch.
3. Add or update tests where the change affects engineering behavior.
4. Include provenance for factual product data.
5. Do not add third-party CAD/drawings unless redistribution permission is documented.
6. Submit a pull request and identify which files contain human-verified engineering changes.

## Local pre-PR validation

Run the complete validation sequence before opening a pull request. In Windows PowerShell:

```powershell
npm.cmd run lint
npm.cmd run format:check
npm.cmd run validate:data
npm.cmd run build
npm.cmd run build:embed
npm.cmd test -- --run
```

On macOS or Linux, use the equivalent commands without `.cmd` (for example, `npm run lint`).
Build commands generate local output under ignored `dist/` directories; do not commit that output.

## Engineering-rule changes

A rule PR should include:
- purpose
- assumptions
- units
- source or project rationale
- boundary cases
- at least one positive and negative test
- reviewer sign-off

## Product advisories

Use `data/templates/advisory.yaml`. Do not elevate a product concern based on a single unsourced forum post.
