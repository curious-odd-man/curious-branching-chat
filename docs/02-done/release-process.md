# Release process

Releases are made **only by CI** (NFR-016, FR-119). Nothing is built or uploaded from a personal computer.

## One-time setup

1. In `electron-builder.yml` replace `YOUR_GITHUB_USER` with the real GitHub user or organization. The repository must
   be **public**, so that installed copies can read releases without a token.
2. Turn on two-factor authentication for every account with write access. Protect `main` (pull request + passing CI).
3. In the repository: Settings > Actions > General > Workflow permissions: "Read and write" (the release workflow
   needs `contents: write`).

## Making a release

1. Update `version` in `package.json` (for example `1.0.0`; pre-release suffixes are refused). Commit to `master`.
2. Wait for CI (`ci.yml`) to pass on that commit.
3. `git tag v1.0.0 && git push origin v1.0.0`.
4. `release.yml` checks that the tag equals the version, runs lint, typecheck, unit and end-to-end tests, builds,
   verifies that the build contains no test hooks, packages the unsigned installer, computes SHA-256, and publishes a
   **stable** GitHub Release with `BranchChat-Setup.exe`, `latest.yml`, `BranchChat-Setup.exe.blockmap` and
   `BranchChat-Setup.exe.sha256`.
5. Edit the release text on GitHub: replace the placeholder under "Что нового" (see `release-notes-template.md`).
   Keep the SmartScreen and SHA-256 sections.
6. Check the release on a clean Windows machine (`windows-test-checklist.md`, sections A, D, H).

## If something is wrong

- Do not move or re-use a tag. Fix, bump the version (`1.0.1`) and tag again.
- A bad release can be turned into a draft on GitHub; installed copies stop being offered it. Copies that already
  updated need a newer version.
