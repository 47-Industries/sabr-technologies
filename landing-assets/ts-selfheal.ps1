# Leon tailnet self-heal (Windows). Checks the REAL data path, not tailscale ping.
$ErrorActionPreference = "Stop"
$peer = "100.81.57.77"   # srv1732802 - Leon's VPS
$log  = "$env:LOCALAPPDATA\leon-tailnet-selfheal.log"
function Log($m){ "$(Get-Date -f s)  $m" | Out-File -Append -Encoding utf8 $log }

$ts = "$env:ProgramFiles\Tailscale\tailscale.exe"
if (!(Test-Path $ts)) { Log "tailscale.exe not found"; exit 1 }

# 1. real data-path probe: TCP to a port we know listens on the tailnet IP
$ok = $false
try {
  $c = New-Object Net.Sockets.TcpClient
  $ok = $c.ConnectAsync($peer, 443).Wait(4000)
  $c.Close()
} catch { $ok = $false }

if ($ok) { Log "OK - tailnet data path healthy"; exit 0 }

# 2. confirm it's a stale tunnel, not just Leon being down: check handshake counters
$j = & $ts status --json | ConvertFrom-Json
$p = $j.Peer.PSObject.Properties.Value | Where-Object { $_.TailscaleIPs -contains $peer }
Log "DEGRADED - tcp443 fail. LastHandshake=$($p.LastHandshake) rx=$($p.RxBytes) tx=$($p.TxBytes)"

# 3. bounce the tunnel (works non-elevated; Restart-Service does not)
& $ts down  | Out-Null
Start-Sleep -Seconds 3
& $ts up    | Out-Null
Start-Sleep -Seconds 6

$ok2 = $false
try { $c = New-Object Net.Sockets.TcpClient; $ok2 = $c.ConnectAsync($peer,443).Wait(6000); $c.Close() } catch {}
Log $(if ($ok2) { "RECOVERED after down/up" } else { "STILL DOWN after down/up - escalate" })
