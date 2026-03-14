param(
  [string]$Command = '',

  [string]$WindowTitle = 'SCUM',

  [string]$OpenInputKey = 't',

  [int]$FocusDelayMs = 350,

  [int]$PreTypeDelayMs = 120,

  [int]$PostSubmitDelayMs = 150,

  [switch]$UseClipboard = $true,

  [switch]$SwitchToAdminChannel = $false,

  [int]$AdminChannelTabs = 1,

  [int]$AdminChannelDelayMs = 80,

  [int]$SubmitKeyCount = 0,

  [int]$InterSubmitDelayMs = 120,

  [switch]$SkipSubmit,

  [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'

if (-not $CheckOnly -and [string]::IsNullOrWhiteSpace($Command)) {
  throw 'Command is required unless -CheckOnly is used.'
}

if (-not $CheckOnly -and -not $Command.Trim().StartsWith('#')) {
  throw 'Only SCUM admin commands starting with # are allowed.'
}

$signature = @'
using System;
using System.Runtime.InteropServices;

public static class NativeInput {
  public const uint KEYEVENTF_KEYUP = 0x0002;

  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool IsIconic(IntPtr hWnd);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

  public static void SendVirtualKey(ushort virtualKey) {
    keybd_event((byte)virtualKey, 0, 0, UIntPtr.Zero);
    keybd_event((byte)virtualKey, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
  }

  public static void KeyDown(ushort virtualKey) {
    keybd_event((byte)virtualKey, 0, 0, UIntPtr.Zero);
  }

  public static void KeyUp(ushort virtualKey) {
    keybd_event((byte)virtualKey, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
  }
}
'@

Add-Type -TypeDefinition $signature -Language CSharp

function Get-ScumWindow {
  param([string]$Title)

  $match = Get-Process |
    Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$Title*" } |
    Sort-Object StartTime -Descending |
    Select-Object -First 1

  if (-not $match) {
    throw "SCUM window not found for title: $Title"
  }

  return $match
}

function Focus-ScumWindow {
  param([System.Diagnostics.Process]$Process)

  $handle = $Process.MainWindowHandle
  if ($handle -eq 0) {
    throw "SCUM process has no main window handle: $($Process.Id)"
  }

  if ([NativeInput]::IsIconic($handle)) {
    [void][NativeInput]::ShowWindowAsync($handle, 9)
    Start-Sleep -Milliseconds 120
  } else {
    [void][NativeInput]::ShowWindowAsync($handle, 5)
  }

  $focused = [NativeInput]::SetForegroundWindow($handle)
  if (-not $focused) {
    Start-Sleep -Milliseconds 100
    [void][NativeInput]::SetForegroundWindow($handle)
  }

  Start-Sleep -Milliseconds $FocusDelayMs
}

function Send-VirtualKey {
  param([UInt16]$KeyCode)

  [NativeInput]::SendVirtualKey($KeyCode)
}

function Send-UnicodeText {
  param([string]$Text)

  if ([string]::IsNullOrEmpty($Text)) {
    return
  }

  foreach ($char in $Text.ToCharArray()) {
    $shell = New-Object -ComObject WScript.Shell
    $shell.SendKeys([string]$char)
    Start-Sleep -Milliseconds 10
  }
}

function Send-CtrlV {
  [NativeInput]::KeyDown(0x11)
  Start-Sleep -Milliseconds 25
  [NativeInput]::SendVirtualKey(0x56)
  Start-Sleep -Milliseconds 25
  [NativeInput]::KeyUp(0x11)
}

function Send-CtrlA {
  [NativeInput]::KeyDown(0x11)
  Start-Sleep -Milliseconds 25
  [NativeInput]::SendVirtualKey(0x41)
  Start-Sleep -Milliseconds 25
  [NativeInput]::KeyUp(0x11)
}

function Resolve-VirtualKey {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $null
  }

  $trimmed = $Value.Trim()
  $named = @{
    ENTER = 0x0D
    TAB = 0x09
    ESC = 0x1B
    SPACE = 0x20
  }

  $namedKey = $named[$trimmed.ToUpperInvariant()]
  if ($namedKey) {
    return [UInt16]$namedKey
  }

  if ($trimmed.Length -eq 1) {
    $code = [int][char]$trimmed.ToUpperInvariant()
    if (($code -ge [int][char]'0' -and $code -le [int][char]'9') -or
        ($code -ge [int][char]'A' -and $code -le [int][char]'Z')) {
      return [UInt16]$code
    }
  }

  throw "Unsupported OpenInputKey value: $Value"
}

function Get-EffectiveSubmitKeyCount {
  param(
    [string]$Text,
    [int]$OverrideCount
  )

  if ($OverrideCount -gt 0) {
    return [Math]::Max(1, [int]$OverrideCount)
  }

  $trimmed = [string]$Text
  if ($trimmed -match '^\s*#(Announce|SpawnItem)\b') {
    return 2
  }

  return 1
}

$targetProcess = Get-ScumWindow -Title $WindowTitle
Focus-ScumWindow -Process $targetProcess

if ($CheckOnly) {
  [pscustomobject]@{
    ok = $true
    mode = 'admin-client-preflight'
    windowTitle = $WindowTitle
    processId = $targetProcess.Id
    openInputKey = $OpenInputKey
    switchToAdminChannel = [bool]$SwitchToAdminChannel
    adminChannelTabs = $AdminChannelTabs
  } | ConvertTo-Json -Compress
  return
}

if ($OpenInputKey) {
  $vk = Resolve-VirtualKey -Value $OpenInputKey
  Send-VirtualKey -KeyCode $vk
  Start-Sleep -Milliseconds $PreTypeDelayMs
}

if ($SwitchToAdminChannel) {
  $tabCount = [Math]::Max(1, [int]$AdminChannelTabs)
  for ($i = 0; $i -lt $tabCount; $i++) {
    Send-VirtualKey -KeyCode 0x09
    Start-Sleep -Milliseconds $AdminChannelDelayMs
  }
}

Send-CtrlA
Start-Sleep -Milliseconds 30
Send-VirtualKey -KeyCode 0x08
Start-Sleep -Milliseconds 40

if ($UseClipboard) {
  Set-Clipboard -Value $Command
  Start-Sleep -Milliseconds 40
  Send-CtrlV
} else {
  Send-UnicodeText -Text $Command
}

if (-not $SkipSubmit) {
  $submitCount = Get-EffectiveSubmitKeyCount -Text $Command -OverrideCount $SubmitKeyCount
  for ($i = 0; $i -lt $submitCount; $i++) {
    Start-Sleep -Milliseconds 50
    Send-VirtualKey -KeyCode 0x0D
    if ($i -lt ($submitCount - 1)) {
      Start-Sleep -Milliseconds $InterSubmitDelayMs
    }
  }
}

Start-Sleep -Milliseconds $PostSubmitDelayMs

[pscustomobject]@{
  ok = $true
  mode = 'admin-client-sendinput'
  windowTitle = $WindowTitle
  command = $Command
  processId = $targetProcess.Id
} | ConvertTo-Json -Compress
