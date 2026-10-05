
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
public struct RECT { public int Left, Top, Right, Bottom; }
'@ -Name L -Namespace C
$result = @()
Get-Process | Where-Object { $_.MainWindowTitle -and $_.MainWindowHandle -ne 0 } | ForEach-Object {
  $r = New-Object C.L+RECT
  if ([C.L]::GetWindowRect($_.MainWindowHandle, [ref]$r)) {
    $result += [ordered]@{ pid = $_.Id; hwnd = $_.MainWindowHandle.ToInt64(); title = $_.MainWindowTitle; width = $r.Right - $r.Left; height = $r.Bottom - $r.Top }
  }
}
if ($result.Count -eq 1) { ConvertTo-Json -Compress -InputObject @($result[0]) | Write-Output }
else { ConvertTo-Json -Compress -InputObject $result | Write-Output }
