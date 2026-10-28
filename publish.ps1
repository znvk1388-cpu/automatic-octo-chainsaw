# Run from a Git checkout with your own GitHub credentials configured.
# Uses the checkout's existing origin and current branch.
param([string]$Message = "Update rigongyizhu")
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $MyInvocation.MyCommand.Path)

$remote = git remote get-url origin
if ($LASTEXITCODE -ne 0 -or $remote -notmatch '^https://github\.com/[^/@:]+/[^/@:]+(?:\.git)?$') {
  throw 'Configure the intended clean GitHub HTTPS origin before publishing.'
}
$branch = git branch --show-current
if ($LASTEXITCODE -ne 0 -or -not $branch) { throw 'Check out a branch before publishing.' }

git fetch origin $branch
if ($LASTEXITCODE -ne 0) { throw 'Fetch failed. Check your configured GitHub credentials.' }
git merge --ff-only "origin/$branch"
if ($LASTEXITCODE -ne 0) { throw 'Review and merge upstream changes before publishing.' }

git add -A
if ($LASTEXITCODE -ne 0) { throw 'Could not stage files.' }
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) { Write-Output 'No changes to publish.'; exit 0 }
git commit -m $Message
if ($LASTEXITCODE -ne 0) { throw 'Commit failed. Check your Git name/email and local changes.' }
git push origin "HEAD:$branch"
if ($LASTEXITCODE -ne 0) { throw 'Push failed. Review the error before retrying.' }
Write-Output "Published to $remote ($branch)."

