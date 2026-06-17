'use strict';

// B3 — shell write-command detector for the Plan-Mode gate. Conservative by design: while the gate
// is armed the agent must not write code via the terminal, so this prefers blocking too much over
// letting a write slip. (A denylist of shell verbs can never be complete against a determined
// adversary — the gate's threat model is a cooperative agent skipping the plan, not an attacker;
// see CHANGELOG note. For stronger guarantees a read-only allowlist would replace this.)
//
// Adversarial-review hardening (v0.2.0): numbered-fd redirects to a path (`2> f`, `1> f`) are writes
// and are now caught (only true fd-dups `>&` are excluded, via the right side); added touch/mkdir/rm,
// curl -o/wget -O, tar -x, unzip, git checkout|apply|restore|stash|reset|clean, awk -i inplace,
// python -m. Verb checks run on the QUOTE-STRIPPED string so a verb inside quotes (echo "cp ...")
// is not a false positive; the heredoc check runs on the RAW string (stripping erases its delimiter).

function detectShellWrite(command) {
  if (typeof command !== 'string' || !command) return false;
  // Strip quoted substrings so a '>' or a verb inside quotes is not misread.
  const stripped = command.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
  // Redirect to a path. Left side `[^&]` excludes only fd-dups (`>&`); a numbered redirect to a
  // file (`2> f`) IS a write and is intentionally caught. Right side `[^&\s|>]` still excludes `2>&1`.
  if (/[^&]>>?\|?[ \t]*[^&\s|>]/.test(stripped)) return true;
  // Heredoc on the RAW command (quote-stripping would erase a quoted delimiter like <<'EOF').
  if (/<<-?[ \t]*['"]?[A-Za-z_]/.test(command)) return true;
  const WRITE_CMDS = [
    /\btee\b/,
    /\bsed\b[^|;]*\s-i\b/,
    /\b(cp|mv|dd|truncate|install|rsync|ln|touch|mkdir|rm|rmdir|unlink|shred)\b/,
    /\b(curl|wget)\b[^|;]*\s-{1,2}[oO]\b/,                 // download to a file
    /\btar\b[^|;]*\s-?-?x/,                                 // tar extract
    /\b(unzip|gunzip|bsdtar|7z)\b/,                         // archive extract
    /\bgit\b[^|;]*\s(checkout|apply|stash|restore|clean|reset)\b/, // overwrite tracked files
    /\b[gm]?awk\b[^|;]*-i[ \t]*inplace/,                    // awk in-place edit
    /\bnode\b[^|;]*\s(?:-e|--eval)\b/,
    /\bpython[0-9.]*\b[^|;]*\s-(?:[ecrI]|m)\b/,             // python -e/-c/-m (modules can write)
    /\b(?:perl|ruby|php)\b[^|;]*\s-[ecrI]\b/,
    /\b(?:Set-Content|Out-File|Add-Content|New-Item|Set-Item|Start-Process|Invoke-Expression|iex|Remove-Item)\b/i,
    /\[\s*IO\.File\s*\]::Write/i,
    /\beval\b/,
    /\bBASH_ENV\b/,
  ];
  return WRITE_CMDS.some((re) => re.test(stripped));
}

module.exports = { detectShellWrite };
