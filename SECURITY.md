# Security policy

## Supported versions

No package has been published yet. During release-candidate review, fixes are prepared only for the
latest `0.1.x` candidate on the active release branch.

| Version | Supported |
|---------|-----------|
| 0.1.x | Yes |
| Earlier development history | No |

## Report a vulnerability

Use GitHub's private
[security advisory form](https://github.com/VitaliiDeveloper/Screenshot-Studio/security/advisories/new).
Do not include exploit details, secrets, personal data, or a proof of concept in a public issue.
If the private form is unavailable, open a minimal public issue asking the maintainer for a private
contact route without disclosing the vulnerability.

Include the affected version/commit, operating system and Node version, impact, reproduction steps,
and any safe mitigation you know. Expect an acknowledgement within three business days and an
initial severity/scope assessment within seven business days. Timelines for a fix and coordinated
disclosure depend on impact and reproducibility.

## Scope

Reports about project-file path traversal, packaged-host extraction, local asset access, generated
output integrity, dependency or archive substitution, and renderer process isolation are in scope.
Ordinary product bugs without a confidentiality, integrity, or availability impact belong in the
public issue tracker.
