# Security policy

## Supported code

No package has been published yet. Security fixes are prepared only for the current code on `main`.

| Code | Supported |
|------|-----------|
| Current `main` branch | Yes |
| Earlier commits, feature branches, and unpublished artifacts | No |

After the first public release, this policy will identify the supported release lines.

## Report a vulnerability

Use GitHub's private
[security advisory form](https://github.com/VitaliiDeveloper/Screenshot-Studio/security/advisories/new).
Do not include exploit details, secrets, personal data, or a proof of concept in a public issue.
If the private form is unavailable, open a minimal public issue asking the maintainer for a private
contact route without disclosing the vulnerability.

Include the affected commit, operating system and Node version, impact, reproduction steps, and any
safe mitigation you know. Reports are triaged privately; response, remediation, and coordinated
disclosure timing depend on impact and reproducibility.

## Scope

Reports about project-file path traversal, packaged-host extraction, local asset access, generated
output integrity, dependency or archive substitution, and renderer process isolation are in scope.
Ordinary product bugs without a confidentiality, integrity, or availability impact belong in the
public issue tracker.
