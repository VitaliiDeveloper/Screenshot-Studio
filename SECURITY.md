# Security policy

## Supported code

Security fixes are prepared on `main` and ship in a new patch release of the latest published
`@screenshot-studio/cli` minor version.

| Code | Supported |
|------|-----------|
| Latest `0.1.x` release of `@screenshot-studio/cli` | Yes |
| Current `main` branch | Yes |
| Earlier releases, commits, feature branches, and unpublished artifacts | No |

## Report a vulnerability

Use GitHub's private
[security advisory form](https://github.com/VitaliiDeveloper/Screenshot-Studio/security/advisories/new).
Do not include exploit details, secrets, personal data, or a proof of concept in a public issue.
If the private form is unavailable, open a minimal public issue asking the maintainer for a private
contact route without disclosing the vulnerability.

Include the affected package version or commit, operating system and Node version, impact, reproduction steps, and any
safe mitigation you know. Reports are triaged privately; response, remediation, and coordinated
disclosure timing depend on impact and reproducibility.

## Scope

Reports about project-file path traversal, packaged-host extraction, local asset access, generated
output integrity, dependency or archive substitution, and renderer process isolation are in scope.
Ordinary product bugs without a confidentiality, integrity, or availability impact belong in the
public issue tracker.
