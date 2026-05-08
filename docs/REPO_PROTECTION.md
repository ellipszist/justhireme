# Repository Protection

Use this checklist for `vasu-devs/JustHireMe` now that the project has public traction.

## Branch Protection For `main`

GitHub repository settings:

1. Open `Settings -> Branches`.
2. Add a branch protection rule for `main`.
3. Enable:
   - Require a pull request before merging
   - Require approvals: 1
   - Require review from Code Owners
   - Dismiss stale pull request approvals when new commits are pushed
   - Require status checks to pass before merging
   - Require branches to be up to date before merging
   - Require conversation resolution before merging
   - Require signed commits if you are ready to sign all maintainer commits
   - Include administrators
   - Do not allow bypassing the above settings
   - Restrict who can push to matching branches

Required status checks:

- `Dependency audit`
- `Frontend`
- `Website`
- `Backend`
- `Rust check`

## Merge Policy

- Prefer squash merge for community PRs.
- Keep direct pushes to `main` for emergency release fixes only.
- All feature work should happen on short-lived branches.
- Security fixes can be private until disclosure is safe.

## Release Safety

- Keep release workflow permissions minimal.
- Use GitHub Environments for production release jobs.
- Require maintainer approval before publishing signed desktop binaries.
- Rotate deployment and feedback tokens after a suspected leak.

## Feedback Issues

Website feedback issues should use these labels:

- `website-feedback`
- `feedback`
- `review`

Filtered inbox:

```txt
https://github.com/vasu-devs/JustHireMe/issues?q=is%3Aissue%20label%3Awebsite-feedback
```
