$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$skillsRoot = Join-Path $projectRoot ".claude\skills"
New-Item -ItemType Directory -Force -Path $skillsRoot | Out-Null

$manifest = @(
  # Superpowers skills (https://github.com/obra/superpowers)
  @{ Name = "brainstorming"; Url = "https://raw.githubusercontent.com/obra/superpowers/main/skills/brainstorming/SKILL.md" },
  @{ Name = "dispatching-parallel-agents"; Url = "https://raw.githubusercontent.com/obra/superpowers/main/skills/dispatching-parallel-agents/SKILL.md" },
  @{ Name = "executing-plans"; Url = "https://raw.githubusercontent.com/obra/superpowers/main/skills/executing-plans/SKILL.md" },
  @{ Name = "finishing-a-development-branch"; Url = "https://raw.githubusercontent.com/obra/superpowers/main/skills/finishing-a-development-branch/SKILL.md" },
  @{ Name = "receiving-code-review"; Url = "https://raw.githubusercontent.com/obra/superpowers/main/skills/receiving-code-review/SKILL.md" },
  @{ Name = "requesting-code-review"; Url = "https://raw.githubusercontent.com/obra/superpowers/main/skills/requesting-code-review/SKILL.md" },
  @{ Name = "subagent-driven-development"; Url = "https://raw.githubusercontent.com/obra/superpowers/main/skills/subagent-driven-development/SKILL.md" },
  @{ Name = "systematic-debugging"; Url = "https://raw.githubusercontent.com/obra/superpowers/main/skills/systematic-debugging/SKILL.md" },
  @{ Name = "test-driven-development"; Url = "https://raw.githubusercontent.com/obra/superpowers/main/skills/test-driven-development/SKILL.md" },
  @{ Name = "using-git-worktrees"; Url = "https://raw.githubusercontent.com/obra/superpowers/main/skills/using-git-worktrees/SKILL.md" },
  @{ Name = "using-superpowers"; Url = "https://raw.githubusercontent.com/obra/superpowers/main/skills/using-superpowers/SKILL.md" },
  @{ Name = "verification-before-completion"; Url = "https://raw.githubusercontent.com/obra/superpowers/main/skills/verification-before-completion/SKILL.md" },
  @{ Name = "writing-plans"; Url = "https://raw.githubusercontent.com/obra/superpowers/main/skills/writing-plans/SKILL.md" },
  @{ Name = "writing-skills"; Url = "https://raw.githubusercontent.com/obra/superpowers/main/skills/writing-skills/SKILL.md" }
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
