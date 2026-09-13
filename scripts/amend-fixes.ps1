Set-Location "C:\famcal"
Remove-Item -Force ".git\index.lock" -ErrorAction SilentlyContinue

git add src/screens/Het.tsx src/components/OccurrenceOverrideModal.tsx vite.config.ts

$msg = ".git\_msg_fix2.txt"
Set-Content -Path $msg -Value @"
fix: build hibak javitasa (round 2)

Het.tsx: duplikat sortLegs import eltavolitva, unused transfer vars torolve
OccurrenceOverrideModal.tsx: custom_location_text kiszedve a template patchbol
vite.config.ts: JSON import 'assert' -> 'with' attribute

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01757gQjCpffzVZUuD7imT4D
"@ -Encoding UTF8

git commit -F $msg
Remove-Item $msg -ErrorAction SilentlyContinue
Write-Host "Fix2 commit kesz!" -ForegroundColor Green
git log --oneline -8
