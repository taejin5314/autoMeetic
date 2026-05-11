param(
    [string]$OutputJson = "harness/wasapi_vbcable_result.json"
)

$ErrorActionPreference = "Stop"

function Get-AudioDevices {
    Get-CimInstance Win32_SoundDevice | Select-Object Name, Manufacturer, Status, PNPDeviceID
}

function Find-VBCableDevices($devices) {
    $patterns = @("VB-Audio", "CABLE Input", "CABLE Output", "VB-Cable")
    $devices | Where-Object {
        $name = $_.Name
        $mfr = $_.Manufacturer
        $patterns | ForEach-Object { ($name -like "*$_*") -or ($mfr -like "*$_*") } | Where-Object { $_ } | Select-Object -First 1
    }
}

function Is-ProcessRunning([string]$name) {
    @(Get-Process -Name $name -ErrorAction SilentlyContinue).Count -gt 0
}

Write-Host "=== B2 WASAPI + VB-Cable Preflight ==="

$devices = Get-AudioDevices
$vbDevices = Find-VBCableDevices $devices
$slackRunning = Is-ProcessRunning -name "slack"
$chromeRunning = Is-ProcessRunning -name "chrome"

Write-Host "\n[Audio Devices]"
$devices | Format-Table -AutoSize

Write-Host "\n[VB-Cable Detection]"
if ($vbDevices.Count -gt 0) {
    Write-Host "PASS: VB-Cable related device detected."
    $vbDevices | Format-Table -AutoSize
} else {
    Write-Host "FAIL: VB-Cable device not detected. Install from https://vb-audio.com/Cable/"
}

Write-Host "\n[Process Hints]"
Write-Host ("Slack running : {0}" -f $slackRunning)
Write-Host ("Chrome running: {0}" -f $chromeRunning)

$manualSteps = @(
    "1) Windows Sound Settings > App volume and device preferences",
    "2) Set Slack output to 'CABLE Input (VB-Audio Virtual Cable)'",
    "3) Keep browser (YouTube) output on default speakers",
    "4) Join Slack huddle and play YouTube simultaneously",
    "5) Capture only CABLE Output in your recorder and verify YouTube leakage is absent"
)

Write-Host "\n[Manual Validation Steps]"
$manualSteps | ForEach-Object { Write-Host $_ }

$result = [ordered]@{
    timestamp = (Get-Date).ToString("s")
    vb_cable_detected = ($vbDevices.Count -gt 0)
    slack_running = $slackRunning
    chrome_running = $chromeRunning
    device_count = @($devices).Count
    vb_device_names = @($vbDevices | ForEach-Object { $_.Name })
    manual_validation_required = $true
    status = if ($vbDevices.Count -gt 0) { "READY_FOR_MANUAL_TEST" } else { "BLOCKED_INSTALL_VB_CABLE" }
}

$dir = Split-Path -Parent $OutputJson
if ($dir -and !(Test-Path $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
}

$result | ConvertTo-Json -Depth 5 | Set-Content -Path $OutputJson -Encoding UTF8
Write-Host "\nSaved preflight result to: $OutputJson"
