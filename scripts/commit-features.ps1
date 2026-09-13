# commit-features.ps1  — F2..F5 commitok
Set-Location "C:\famcal"

function Do-Commit {
    param([string]$MsgFile, [string[]]$Files)
    Remove-Item -Force ".git\index.lock" -ErrorAction SilentlyContinue
    git add @Files
    git commit -F $MsgFile
    if ($LASTEXITCODE -ne 0) { Write-Error "Commit failed!"; exit 1 }
    Remove-Item $MsgFile -ErrorAction SilentlyContinue
    Write-Host "OK" -ForegroundColor Green
}

# F2
$m2 = ".git\_msg_f2.txt"
Set-Content -Path $m2 -Value @"
feat(F2): sortLegs -- pickup elobb, dropoff utana azonos idopontban

Exportalt sortLegs<T>() fuggveny: pickup (<) mindig megelozi
a dropoff-ot (>) azonos depart_at eseten. Alkalmazva: Het es
Fuvartabla nezetekben minden legbetoltesenel.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01757gQjCpffzVZUuD7imT4D
"@ -Encoding UTF8
Write-Host "F2 commit..."
Do-Commit -MsgFile $m2 -Files @("src/lib/occurrences.ts","src/screens/Het.tsx","src/screens/Fuvartabla.tsx")

# F3
$m3 = ".git\_msg_f3.txt"
Set-Content -Path $m3 -Value @"
feat(F3): verzio megjelenitese -- v0.2.0 badge a Beallitasokban

package.json: 0.0.0 -> 0.2.0 + version bump scriptek.
vite.config.ts: __APP_VERSION__ define a pkg.version alapjan.
src/vite-env.d.ts: TypeScript globalis deklaracio.
Beallitasok: verzio-badge a kijelentkezes gomb felett.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01757gQjCpffzVZUuD7imT4D
"@ -Encoding UTF8
Write-Host "F3 commit..."
Do-Commit -MsgFile $m3 -Files @("package.json","vite.config.ts","src/vite-env.d.ts","src/screens/Beallitasok.tsx")

# F4
$m4 = ".git\_msg_f4.txt"
Set-Content -Path $m4 -Value @"
feat(F4): useRole -- parent=admin, grandparent=korlatozott jogok

Uj useRole hook: isAdmin, canDriveOnly, canSeeSablon.
BottomNav: Sablon tab elrejtve grandparent elott.
Fuvartabla: dotdot gomb es driver-picker gated.
Het: dotdot gomb gated.
OccurrenceOverrideModal: isAdmin prop, akcio-valaszto gated.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01757gQjCpffzVZUuD7imT4D
"@ -Encoding UTF8
Write-Host "F4 commit..."
Do-Commit -MsgFile $m4 -Files @("src/hooks/useRole.ts","src/components/BottomNav.tsx","src/screens/Fuvartabla.tsx","src/screens/Het.tsx","src/components/OccurrenceOverrideModal.tsx")

# F5
$m5 = ".git\_msg_f5.txt"
Set-Content -Path $m5 -Value @"
feat(F5): custom_location_text -- egyszeri cim az occurrence-en

Supabase migration: custom_location_text nullable text mezo.
src/types: Occurrence interfaceben uj mezo.
src/lib/occurrences: patch + reset tamogatasa.
OccurrenceOverrideModal: uj cim-input mezo (isAdmin gatelt).
Het nezet: custom_location_text jelenik meg, ha ki van toltve.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01757gQjCpffzVZUuD7imT4D
"@ -Encoding UTF8
Write-Host "F5 commit..."
Do-Commit -MsgFile $m5 -Files @("supabase/migrations/20260907000001_occurrence_custom_location.sql","src/types/index.ts","src/lib/occurrences.ts","src/components/OccurrenceOverrideModal.tsx","src/screens/Het.tsx")

Write-Host ""
Write-Host "Mind az 5 feature commitolva!" -ForegroundColor Cyan
git log --oneline -6
