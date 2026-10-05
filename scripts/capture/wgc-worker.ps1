# WGC capture worker v3 (hybrid final): PS does raw COM to obtain gfxPtr and
# itemPtr (both proven working in PS/STA), then WgcSession (winmd-compiled)
# runs every WinRT call internally.
param([long]$TargetHwnd)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class RawCom {
    [DllImport("d3d11.dll", EntryPoint = "D3D11CreateDevice")]
    public static extern int D3D11CreateDevice(IntPtr adapter, uint driverType, uint software, uint flags, IntPtr featureLevels, uint numFeatureLevels, uint sdkVersion, out IntPtr device, out IntPtr context, out IntPtr featureLevel);
    [DllImport("d3d11.dll")]
    public static extern int CreateDirect3D11DeviceFromDXGIDevice(IntPtr dxgiDevice, out IntPtr graphicsDevice);
    [DllImport("combase.dll", CharSet = CharSet.Unicode)]
    public static extern int WindowsCreateString(string s, int len, out IntPtr h);
    [DllImport("combase.dll")]
    public static extern int RoGetActivationFactory(IntPtr h, ref Guid iid, out IntPtr f);
    [ComImport, Guid("3628E81B-3CAC-4C60-B7F4-23CE0E0C3356"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IGraphicsCaptureItemInterop {
        // derives from IUnknown only (per graphicscaptureinterop.h)
        IntPtr CreateForWindow(IntPtr window, ref Guid iid);
        IntPtr CreateForMonitor(IntPtr hmon, ref Guid iid);
    }
    public static IntPtr ItemFromWindow(IntPtr hwnd) {
        IntPtr h;
        string cls = "Windows.Graphics.Capture.GraphicsCaptureItem";
        Marshal.ThrowExceptionForHR(WindowsCreateString(cls, cls.Length, out h));
        Guid g = new Guid("3628E81B-3CAC-4C60-B7F4-23CE0E0C3356");
        IntPtr factory;
        Marshal.ThrowExceptionForHR(RoGetActivationFactory(h, ref g, out factory));
        var interop = (IGraphicsCaptureItemInterop)Marshal.GetObjectForIUnknown(factory);
        Guid gi = new Guid("79C3F95B-31F7-4EC2-A464-632EF5D30760");
        return interop.CreateForWindow(hwnd, ref gi);
    }
}
"@

$helper = [Reflection.Assembly]::LoadFrom((Join-Path $PSScriptRoot "wgc_helper.dll"))
$S = $helper.GetType("WgcSession")

$out = [Console]::Out
try {
    $devPtr = [IntPtr]::Zero; $ctxPtr = [IntPtr]::Zero; $flPtr = [IntPtr]::Zero
    $hr = [RawCom]::D3D11CreateDevice([IntPtr]::Zero, 1, 0, 0x20, [IntPtr]::Zero, 0, 7, [ref]$devPtr, [ref]$ctxPtr, [ref]$flPtr)
    if ($hr -ne 0) { throw ("D3D11CreateDevice hr=0x{0:X}" -f $hr) }
    $iidDxgi = [Guid]"54ec77fa-1377-44e6-8c32-88fd5f44c84c"
    $dxgiPtr = [IntPtr]::Zero
    [Runtime.InteropServices.Marshal]::QueryInterface($devPtr, [ref]$iidDxgi, [ref]$dxgiPtr) | Out-Null
    $gfxPtr = [IntPtr]::Zero
    $hr = [RawCom]::CreateDirect3D11DeviceFromDXGIDevice($dxgiPtr, [ref]$gfxPtr)
    if ($hr -ne 0) { throw ("CreateDirect3D11DeviceFromDXGIDevice hr=0x{0:X}" -f $hr) }
    $itemPtr = [RawCom]::ItemFromWindow([IntPtr]$TargetHwnd)
    if ($itemPtr -eq [IntPtr]::Zero) { throw "ItemFromWindow failed" }

    $S.GetMethod("StartSession").Invoke($null, @([IntPtr]$TargetHwnd, $gfxPtr, $itemPtr)) | Out-Null

    $out.WriteLine('READY')
    $out.Flush()

    while ($true) {
        $line = [Console]::In.ReadLine()
        if ($null -eq $line) { break }
        $parts = $line -split ' '
        if ($parts[0] -ne 'CAP') { continue }
        try {
            $png = $S.GetMethod("GrabFrame").Invoke($null, @())
            $out.WriteLine('FRAME ' + [Convert]::ToBase64String($png))
        } catch {
            $inner = $_.Exception
            if ($inner.InnerException) { $inner = $inner.InnerException }
            $out.WriteLine('ERR ' + ($inner.Message -replace "[\r\n]", ' '))
        }
        $out.Flush()
    }
    $S.GetMethod("StopSession").Invoke($null, @()) | Out-Null
}
catch {
    $out.WriteLine('ERR ' + ($_.Exception.Message -replace "[\r\n]", ' '))
    $out.Flush()
    exit 1
}
