$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -MemberDefinition '
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
[DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr hWnd);
[DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
[DllImport("gdi32.dll")] public static extern bool BitBlt(IntPtr hdcDest, int nXDest, int nYDest, int nWidth, int nHeight, IntPtr hdcSrc, int nXSrc, int nYSrc, int dwRop);
[DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleDC(IntPtr hdc);
[DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleBitmap(IntPtr hdc, int nWidth, int nHeight);
[DllImport("gdi32.dll")] public static extern IntPtr SelectObject(IntPtr hdc, IntPtr hgdiobj);
[DllImport("gdi32.dll")] public static extern bool DeleteDC(IntPtr hdc);
[DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr hObject);
public struct RECT { public int Left, Top, Right, Bottom; }
' -Name L -Namespace C
$out = [Console]::Out
$out.WriteLine('READY')
$out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $parts = $line -split ' '
  if ($parts[0] -ne 'CAP' -or $parts.Length -lt 2) { continue }
  $h = [IntPtr]([Int64]$parts[1])
  $screendc = [IntPtr]::Zero; $memdc = [IntPtr]::Zero; $hbm = [IntPtr]::Zero; $bmp = $null
  try {
    $r = New-Object C.L+RECT
    if (-not [C.L]::GetWindowRect($h, [ref]$r)) { throw 'GetWindowRect failed' }
    $w = $r.Right - $r.Left; $ht = $r.Bottom - $r.Top
    if ($w -lt 8 -or $ht -lt 8) { throw 'minimized-or-closed' }
    $screendc = [C.L]::GetDC([IntPtr]::Zero)
    $memdc = [C.L]::CreateCompatibleDC($screendc)
    $hbm = [C.L]::CreateCompatibleBitmap($screendc, $w, $ht)
    [C.L]::SelectObject($memdc, $hbm) | Out-Null
    if (-not [C.L]::BitBlt($memdc, 0, 0, $w, $ht, $screendc, $r.Left, $r.Top, 0x00CC0020 -bor 0x40000000)) { throw 'BitBlt failed' }
    $bmp = [System.Drawing.Image]::FromHbitmap($hbm)
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $out.WriteLine('FRAME ' + [Convert]::ToBase64String($ms.ToArray()))
  } catch {
    $out.WriteLine('ERR ' + ($_.Exception.Message -replace "[\r\n]", ' '))
  } finally {
    if ($bmp) { $bmp.Dispose() }
    if ($hbm -ne [IntPtr]::Zero) { [C.L]::DeleteObject($hbm) | Out-Null }
    if ($memdc -ne [IntPtr]::Zero) { [C.L]::DeleteDC($memdc) | Out-Null }
    if ($screendc -ne [IntPtr]::Zero) { [C.L]::ReleaseDC([IntPtr]::Zero, $screendc) | Out-Null }
  }
  $out.Flush()
}
