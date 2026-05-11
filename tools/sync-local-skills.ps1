$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$skillsRoot = Join-Path $projectRoot ".claude\skills"
New-Item -ItemType Directory -Force -Path $skillsRoot | Out-Null

$manifest = @(
  @{ Name = "design-taste-frontend"; Url = "https://raw.githubusercontent.com/Leonxlnx/taste-skill/main/skills/taste-skill/SKILL.md" },
  @{ Name = "autoplan"; Url = "https://raw.githubusercontent.com/garrytan/gstack/main/autoplan/SKILL.md" },
  @{ Name = "benchmark"; Url = "https://raw.githubusercontent.com/garrytan/gstack/main/benchmark/SKILL.md" },
  @{ Name = "benchmark-models"; Url = "https://raw.githubusercontent.com/garrytan/gstack/main/benchmark-models/SKILL.md" },
  @{ Name = "browse"; Url = "https://raw.githubusercontent.com/garrytan/gstack/main/browse/SKILL.md" },
  @{ Name = "canary"; Url = "https://raw.githubusercontent.com/garrytan/gstack/main/canary/SKILL.md" },
  @{ Name = "careful"; Url = "https://raw.githubusercontent.com/garrytan/gstack/main/careful/SKILL.md" },
  @{ Name = "codex"; Url = "https://raw.githubusercontent.com/garrytan/gstack/main/codex/SKILL.md" },
  # gstack moved this capability to open-gstack-browser; keep local alias folder updated.
  @{ Name = "connect-chrome"; Url = "https://raw.githubusercontent.com/garrytan/gstack/main/open-gstack-browser/SKILL.md" },
  @{ Name = "context-restore"; Url = "https://raw.githubusercontent.com/garrytan/gstack/main/context-restore/SKILL.md" },
  @{ Name = "context-save"; Url = "https://raw.githubusercontent.com/garrytan/gstack/main/context-save/SKILL.md" },
  @{ Name = "cso"; Url = "https://raw.githubusercontent.com/garrytan/gstack/main/cso/SKILL.md" },
  @{ Name = "design-consultation"; Url = "https://raw.githubusercontent.com/garrytan/gstack/main/design-consultation/SKILL.md" },
  @{ Name = "design-html"; Url = "https://raw.githubusercontent.com/garrytan/gstack/main/design-html/SKILL.md" },
  @{ Name = "design-review"; Url = "https://raw.githubusercontent.com/garrytan/gstack/main/design-review/SKILL.md" },
  @{ Name = "design-shotgun"; Url = "https://raw.githubusercontent.com/garrytan/gstack/main/design-shotgun/SKILL.md" },
  @{ Name = "devex-review"; Url = "https://raw.githubusercontent.com/garrytan/gstack/main/devex-review/SKILL.md" },
  @{ Name = "document-release"; Url = "https://raw.githubusercontent.com/garrytan/gstack/main/document-release/SKILL.md" },
  @{ Name = "freeze"; Url = "https://raw.githubusercontent.com/garrytan/gstack/main/freeze/SKILL.md" },
  @{ Name = "gstack-upgrade"; Url = "https://raw.githubusercontent.com/garrytan/gstack/main/gstack-upgrade/SKILL.md" },
  @{ Name = "guard"; Url = "https://raw.githubusercontent.com/garrytan/gstack/main/guard/SKILL.md" },
  @{ Name = "health"; Url = "https://raw.githubusercontent.com/garrytan/gstack/main/health/SKILL.md" },
  @{ Name = "investigate"; Url = "https://raw.githubusercontent.com/garrytan/gstack/main/investigate/SKILL.md" },
  @{ Name = "land-and-deploy"; Url = "https://raw.githubusercontent.com/garrytan/gstack/main/land-and-deploy/SKILL.md" },
  @{ Name = "learn"; Url = "https://raw.githubusercontent.com/garrytan/gstack/main/learn/SKILL.md" },
  @{ Name = "make-pdf"; Url = "https://raw.githubusercontent.com/garrytan/gstack/main/make-pdf/SKILL.md" },
  @{ Name = "office-hours"; Url = "https://raw.githubusercontent.com/garrytan/gstack/main/office-hours/SKILL.md" },
  @{ Name = "open-gstack-browser"; Url = "https://raw.githubusercontent.com/garrytan/gstack/main/open-gstack-browser/SKILL.md" },
  @{ Name = "pair-agent"; Url = "https://raw.githubusercontent.com/garrytan/gstack/main/pair-agent/SKILL.md" },
  @{ Name = "plan-ceo-review"; Url = "https://raw.githubusercontent.com/garrytan/gstack/main/plan-ceo-review/SKILL.md" },
  @{ Name = "plan-design-review"; Url = "https://raw.githubusercontent.com/garrytan/gstack/main/plan-design-review/SKILL.md" },
  @{ Name = "plan-devex-review"; Url = "https://raw.githubusercontent.com/garrytan/gstack/main/plan-devex-review/SKILL.md" },
  @{ Name = "plan-eng-review"; Url = "https://raw.githubusercontent.com/garrytan/gstack/main/plan-eng-review/SKILL.md" },
  @{ Name = "plan-tune"; Url = "https://raw.githubusercontent.com/garrytan/gstack/main/plan-tune/SKILL.md" },
  @{ Name = "qa"; Url = "https://raw.githubusercontent.com/garrytan/gstack/main/qa/SKILL.md" },
  @{ Name = "qa-only"; Url = "https://raw.githubusercontent.com/garrytan/gstack/main/qa-only/SKILL.md" },
  @{ Name = "retro"; Url = "https://raw.githubusercontent.com/garrytan/gstack/main/retro/SKILL.md" },
  @{ Name = "review"; Url = "https://raw.githubusercontent.com/garrytan/gstack/main/review/SKILL.md" },
  @{ Name = "setup-browser-cookies"; Url = "https://raw.githubusercontent.com/garrytan/gstack/main/setup-browser-cookies/SKILL.md" },
  @{ Name = "setup-deploy"; Url = "https://raw.githubusercontent.com/garrytan/gstack/main/setup-deploy/SKILL.md" },
  @{ Name = "ship"; Url = "https://raw.githubusercontent.com/garrytan/gstack/main/ship/SKILL.md" },
  @{ Name = "unfreeze"; Url = "https://raw.githubusercontent.com/garrytan/gstack/main/unfreeze/SKILL.md" }
)

$updated = 0
$unchanged = 0
$failed = 0

foreach ($item in $manifest) {
  $skillDir = Join-Path $skillsRoot $item.Name
  $target = Join-Path $skillDir "SKILL.md"
  $tmp = Join-Path $env:TEMP ("skill-" + [Guid]::NewGuid().ToString() + ".md")

  try {
    New-Item -ItemType Directory -Force -Path $skillDir | Out-Null
    Invoke-WebRequest -Uri $item.Url -OutFile $tmp -UseBasicParsing

    if (Test-Path $target) {
      $oldHash = (Get-FileHash -Path $target -Algorithm SHA256).Hash
      $newHash = (Get-FileHash -Path $tmp -Algorithm SHA256).Hash
      if ($oldHash -eq $newHash) {
        Remove-Item $tmp -Force
        $unchanged++
        Write-Host "unchanged: $($item.Name)"
        continue
      }
    }

    Move-Item -Force -Path $tmp -Destination $target
    $updated++
    Write-Host "updated:   $($item.Name)"
  }
  catch {
    if (Test-Path $tmp) { Remove-Item $tmp -Force }
    $failed++
    Write-Host "failed:    $($item.Name) - $($_.Exception.Message)"
  }
}

Write-Host "---"
Write-Host "skills sync complete"
Write-Host "updated:   $updated"
Write-Host "unchanged: $unchanged"
Write-Host "failed:    $failed"

# Keep folder-open task non-blocking.
exit 0
