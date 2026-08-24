# Run once on Windows (no admin needed). Installs the self-heal on logon + every 5 min.
$dir = "$env:LOCALAPPDATA\Leon"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Invoke-WebRequest -UseBasicParsing "https://sabrtechnologies.com/landing-assets/ts-selfheal.ps1" -OutFile "$dir\ts-selfheal.ps1"
$act = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$dir\ts-selfheal.ps1`""
$t1  = New-ScheduledTaskTrigger -AtLogOn
$t2  = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$set = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName "Leon Tailnet Self-Heal" -Action $act -Trigger $t1,$t2 -Settings $set -Force | Out-Null
& "$dir\ts-selfheal.ps1"
Write-Host "Installed. Log: $env:LOCALAPPDATA\leon-tailnet-selfheal.log"
