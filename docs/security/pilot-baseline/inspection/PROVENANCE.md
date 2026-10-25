# Inspection provenance — `security-audit` skill

The pilot's Phase A.2 third-party run used the Cloudflare `security-audit`
skill. The exact source that was inspected is vendored under
`security-audit-skill/` so the pilot's evidentiary basis stays reproducible
even if the upstream repository changes or reorganises.

| Field | Value |
| --- | --- |
| Upstream | `https://github.com/cloudflare/security-audit-skill.git` |
| Commit | `c1c8a8c1471069fb0e188eeaff69b8e8db6564a8` |
| Commit date | 2026-09-14 20:28:54 +0100 |
| Commit subject | Clarify guidance and full audit modes |
| License | MIT (see `security-audit-skill/LICENSE`) |
| Inspected | 2026-10-24, during pilot `sec-pilot-third-party-9fbf1794` |

## Reproduction

```bash
git clone https://github.com/cloudflare/security-audit-skill.git /tmp/security-audit-skill
git -C /tmp/security-audit-skill checkout c1c8a8c1471069fb0e188eeaff69b8e8db6564a8
diff -r --exclude=.git /tmp/security-audit-skill \
  docs/security/pilot-baseline/inspection/security-audit-skill
```

## Why vendored rather than merely referenced

- The pilot's findings are only auditable if the exact inspected source is
  available. A bare URL is not enough if upstream force-pushes, retires
  companion playbooks, or disappears.
- The commit SHA is pinned, so the vendored copy is verifiable byte-for-byte
  with the reproduction command above.
- MIT permits redistribution provided the license notice is retained;
  `security-audit-skill/LICENSE` is included unmodified.

The copy the agent actually loaded at run time lives at
`~/.config/opencode/skills/security-audit/` on the operator's machine. That
installed copy is a runtime convenience, not the authoritative record; this
directory is.
