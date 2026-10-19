<#
.SYNOPSIS
    Runs the Riftbound Deck Simulator on this PC: serves the app in docs/ on
    http://localhost and gives it read/write access to the Decks\*.csv files.

.DESCRIPTION
    The simulator itself is docs/engine.js and runs inside the browser - the
    exact same code the phone app runs from GitHub Pages. This server only
    does two things:
    - serves the docs/ folder (index.html, app.js, engine.js, card data...)
    - GET /api/decks returns every deck CSV under Decks\ and PUT /api/decks
      saves one (used by "Import a deck"), so on the PC the CSV files stay the
      source of truth instead of the browser's own storage.
    engine.js detects /api/decks and uses it; on the phone it isn't there, so
    decks live in the browser's IndexedDB instead.

    This does NOT make the simulator reachable from the internet or from
    other devices - it only listens on http://localhost, which only your own
    computer can reach.

    Uses .NET's built-in HttpListener - no extra software (Python, Node, IIS)
    needs to be installed. Binding to "localhost" specifically (rather than a
    wildcard address) avoids needing Administrator rights on Windows.

.PARAMETER NoBrowser
    Don't open the browser automatically (e.g. when something else opens it).

.NOTES
    Run this via RunWebUI.bat (recommended), or manually with:
        cd "C:\path\to\RiftboundSimulator"
        .\WebServer.ps1
    It opens your browser on the right address by itself. Press Ctrl+C in
    this window (or just close it) to stop the server.
#>
param([switch]$NoBrowser)

# ============================================================================
#  SETUP
# ============================================================================
$Script:Port      = 8787
$Script:RootPath  = $PSScriptRoot
$Script:WebRoot   = Join-Path $RootPath 'docs'
$Script:DecksRoot = Join-Path $RootPath 'Decks'

Import-Module (Join-Path $PSScriptRoot 'DeckFiles.psm1') -Force

# ============================================================================
#  RESPONSES
# ============================================================================
function Get-ContentType {
    param([string]$Extension)
    switch ($Extension.ToLowerInvariant()) {
        '.html'        { return 'text/html; charset=utf-8' }
        '.css'         { return 'text/css; charset=utf-8' }
        '.js'          { return 'application/javascript; charset=utf-8' }
        '.json'        { return 'application/json; charset=utf-8' }
        '.webmanifest' { return 'application/manifest+json; charset=utf-8' }
        '.svg'         { return 'image/svg+xml' }
        '.png'         { return 'image/png' }
        '.webp'        { return 'image/webp' }
        '.ico'         { return 'image/x-icon' }
        default        { return 'application/octet-stream' }
    }
}

function Send-FileResponse {
    param([System.Net.HttpListenerResponse]$Response, [string]$FilePath)

    if (-not (Test-Path $FilePath -PathType Leaf)) {
        $Response.StatusCode = 404
        $bytes = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
        $Response.ContentLength64 = $bytes.Length
        $Response.OutputStream.Write($bytes, 0, $bytes.Length)
        return
    }
    $bytes = [System.IO.File]::ReadAllBytes($FilePath)
    $Response.ContentType = Get-ContentType ([System.IO.Path]::GetExtension($FilePath))
    # Always revalidate, so an edit to a file under docs/ shows up on the next reload.
    $Response.AddHeader('Cache-Control', 'no-cache')
    $Response.ContentLength64 = $bytes.Length
    $Response.OutputStream.Write($bytes, 0, $bytes.Length)
}

function Send-JsonResponse {
    param([System.Net.HttpListenerResponse]$Response, [object]$Data, [int]$StatusCode = 200)

    $Response.StatusCode = $StatusCode
    # -InputObject (not the pipeline) so a one-element array stays an array.
    $json = ConvertTo-Json -InputObject $Data -Depth 8
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $Response.ContentType = 'application/json; charset=utf-8'
    $Response.AddHeader('Cache-Control', 'no-store')
    $Response.ContentLength64 = $bytes.Length
    $Response.OutputStream.Write($bytes, 0, $bytes.Length)
}

function Get-RequestBody {
    param([System.Net.HttpListenerRequest]$Request)
    # engine.js always sends UTF-8 JSON (card names can carry curly quotes).
    $reader = New-Object System.IO.StreamReader($Request.InputStream, [System.Text.Encoding]::UTF8)
    $text = $reader.ReadToEnd()
    $reader.Close()
    if ([string]::IsNullOrWhiteSpace($text)) { return $null }
    return $text | ConvertFrom-Json
}

# ============================================================================
#  SERVER
# ============================================================================
# Try the configured port first, then a handful of fallback ports. A
# "conflicts with an existing registration" error means something is
# ALREADY bound to that exact prefix - most often a previous WebServer.ps1
# window that never got closed (running as Administrator does not help with
# that, since it's a different process holding the port, not a permissions
# problem). Rather than making the person hunt that process down every time,
# just find a free port automatically.
$listener = $null
$boundPort = $null
$lastError = $null
$portsToTry = @($Script:Port) + (1..9 | ForEach-Object { $Script:Port + $_ })

foreach ($p in $portsToTry) {
    $candidate = New-Object System.Net.HttpListener
    $candidate.Prefixes.Add("http://localhost:$p/")
    try {
        $candidate.Start()
        $listener = $candidate
        $boundPort = $p
        break
    }
    catch {
        $lastError = $_
        $candidate.Close()
    }
}

if (-not $listener) {
    Write-Host ""
    Write-Host "ERROR: could not start the local web server on any port from $($portsToTry[0]) to $($portsToTry[-1])." -ForegroundColor Red
    Write-Host $lastError.Exception.Message -ForegroundColor Red
    Write-Host ""
    Write-Host "Most likely cause: an earlier 'Riftbound Web Server' window is still" -ForegroundColor Yellow
    Write-Host "running in the background (check your taskbar / Task Manager for a" -ForegroundColor Yellow
    Write-Host "powershell.exe window titled 'Riftbound Web Server' and close it), or" -ForegroundColor Yellow
    Write-Host "some other application already used all of these ports." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "You can also check what's using port $($Script:Port) yourself by running:" -ForegroundColor Yellow
    Write-Host "  netstat -ano | findstr :$($Script:Port)" -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Press Enter to close this window"
    exit 1
}

$Script:Port = $boundPort
$prefix = "http://localhost:$boundPort/"

Write-Host ""
Write-Host ("=" * 60) -ForegroundColor Cyan
Write-Host "  Riftbound Deck Simulator - local web server running" -ForegroundColor Cyan
Write-Host ("=" * 60) -ForegroundColor Cyan
Write-Host ""
Write-Host "  Open this in your browser:  $prefix" -ForegroundColor Green
if ($boundPort -ne $portsToTry[0]) {
    Write-Host "  (Port $($portsToTry[0]) was unavailable, so it switched to $boundPort.)" -ForegroundColor DarkGray
}
Write-Host ""
Write-Host "  This only listens on your own computer (localhost) - nothing" -ForegroundColor DarkGray
Write-Host "  here is reachable from the internet or other devices." -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Press Ctrl+C or close this window to stop the server." -ForegroundColor DarkGray
Write-Host ""

if (-not $NoBrowser) {
    try {
        Start-Process $prefix | Out-Null
    }
    catch {
        Write-Host "  (Could not open your browser automatically - open $prefix manually.)" -ForegroundColor Yellow
        Write-Host ""
    }
}

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()   # blocks until a request comes in
        $request = $context.Request
        $response = $context.Response

        $path = $request.Url.AbsolutePath
        $method = $request.HttpMethod
        $statusLine = "OK"

        try {
            if ($method -eq 'GET' -and $path -eq '/api/decks') {
                Send-JsonResponse -Response $response -Data (Get-DeckRecords -DecksRoot $Script:DecksRoot)
            }
            elseif ($method -eq 'PUT' -and $path -eq '/api/decks') {
                $record = Get-RequestBody -Request $request
                if (-not $record) { throw "No deck was sent." }
                $overwritten = Save-DeckRecord -DecksRoot $Script:DecksRoot -Record $record
                Send-JsonResponse -Response $response -Data ([PSCustomObject]@{ saved = $true; id = $record.id; overwritten = $overwritten })
            }
            elseif ($method -eq 'GET' -and $path -eq '/favicon.ico') {
                # No .ico is shipped (index.html points at icons/icon-192.png);
                # answer "no content" so it doesn't log as an error.
                $response.StatusCode = 204
                $statusLine = "204"
            }
            elseif ($method -eq 'GET') {
                $relative = if ($path -eq '/') { 'index.html' } else { [System.Uri]::UnescapeDataString($path.TrimStart('/')) }
                $resolvedRoot = [System.IO.Path]::GetFullPath($Script:WebRoot).TrimEnd('\')
                $resolvedFile = [System.IO.Path]::GetFullPath((Join-Path $resolvedRoot $relative))
                if (-not $resolvedFile.StartsWith($resolvedRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
                    $response.StatusCode = 403
                    $statusLine = "403"
                } else {
                    Send-FileResponse -Response $response -FilePath $resolvedFile
                    if ($response.StatusCode -eq 404) { $statusLine = "404" }
                }
            }
            else {
                $response.StatusCode = 405
                $statusLine = "405"
            }
        }
        catch {
            $statusLine = "ERROR: $($_.Exception.Message)"
            Send-JsonResponse -Response $response -Data ([PSCustomObject]@{ error = $_.Exception.Message }) -StatusCode 500
        }
        finally {
            Write-Host ("  [{0}] {1} {2} -> {3}" -f (Get-Date -Format 'HH:mm:ss'), $method, $path, $statusLine) -ForegroundColor DarkGray
            $response.OutputStream.Close()
        }
    }
}
finally {
    $listener.Stop()
    $listener.Close()
}
