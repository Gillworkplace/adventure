// WgcSession v2 — session-based. PS only supplies raw pointers/ints; every
// WinRT API call happens inside this winmd-compiled assembly.
// StartSession(hwnd, gfxPtr, itemPtr); GrabFrame() -> latest PNG bytes; StopSession().
using System;
using System.Runtime.InteropServices;
using Windows.Foundation;
using Windows.Graphics;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX;
using Windows.Graphics.DirectX.Direct3D11;
using Windows.Graphics.Imaging;
using Windows.Storage.Streams;

public static class WgcSession {
    static IDirect3DDevice device;
    static Direct3D11CaptureFramePool pool;
    static GraphicsCaptureSession session;

    static T Wait<T>(IAsyncOperation<T> op) {
        while (op.Status == AsyncStatus.Started) System.Threading.Thread.Sleep(4);
        if (op.Status == AsyncStatus.Error) throw op.ErrorCode;
        return op.GetResults();
    }
    static void Wait(IAsyncAction action) {
        while (action.Status == AsyncStatus.Started) System.Threading.Thread.Sleep(4);
        if (action.Status == AsyncStatus.Error) throw action.ErrorCode;
    }

    public static SizeInt32 RectSize(IntPtr hwnd) {
        Native.RECT r;
        if (!Native.GetWindowRect(hwnd, out r)) r = default(Native.RECT);
        SizeInt32 s = default(SizeInt32);
        s.Width = Math.Max(1, r.Right - r.Left);
        s.Height = Math.Max(1, r.Bottom - r.Top);
        return s;
    }

    static SizeInt32 poolSize;

    public static void StartSession(IntPtr hwnd, IntPtr gfxPtr, IntPtr itemPtr) {
        device = (IDirect3DDevice)Marshal.GetObjectForIUnknown(gfxPtr);
        var item = (GraphicsCaptureItem)Marshal.GetObjectForIUnknown(itemPtr);
        if (pool != null) StopSession();
        poolSize = RectSize(hwnd);
        pool = Direct3D11CaptureFramePool.CreateFreeThreaded(device, DirectXPixelFormat.B8G8R8A8UIntNormalized, 2, poolSize);
        session = pool.CreateCaptureSession(item);
        try { session.IsCursorCaptureEnabled = false; } catch { }
        session.StartCapture();
        draining = true;
        System.Threading.Tasks.Task.Run((Action)DrainLoop);
    }

    static byte[] Encode(Direct3D11CaptureFrame frame) {
        SoftwareBitmap bitmap = Wait<SoftwareBitmap>(SoftwareBitmap.CreateCopyFromSurfaceAsync(frame.Surface));
        try {
            InMemoryRandomAccessStream ms = new InMemoryRandomAccessStream();
            BitmapEncoder encoder = Wait<BitmapEncoder>(BitmapEncoder.CreateAsync(BitmapEncoder.PngEncoderId, ms));
            encoder.SetSoftwareBitmap(bitmap);
            Wait((IAsyncAction)encoder.FlushAsync());
            ms.Seek(0);
            int size = (int)ms.Size;
            DataReader reader = new DataReader(ms.GetInputStreamAt(0));
            Wait<uint>(reader.LoadAsync((uint)size));
            byte[] bytes = new byte[size];
            reader.ReadBytes(bytes);
            return bytes;
        } finally { bitmap.Dispose(); }
    }

    static volatile byte[] cached;
    static volatile bool draining;
    static volatile int lastNewTick;

    static void DrainLoop() {
        long lastEncode = 0;
        while (draining) {
            try {
                Direct3D11CaptureFrame frame = pool.TryGetNextFrame();
                if (frame == null) { System.Threading.Thread.Sleep(15); continue; }
                // 窗口尺寸变化时旧池仍按原尺寸出帧：新内容只占左上角，
                // 其余为过期像素。按 ContentSize 重建池（会话保持）。
                var content = frame.ContentSize;
                if (content.Width > 0 && content.Height > 0 &&
                    (content.Width != poolSize.Width || content.Height != poolSize.Height)) {
                    poolSize = content;
                    frame.Dispose();
                    pool.Recreate(device, DirectXPixelFormat.B8G8R8A8UIntNormalized, 2, content);
                    cached = null;
                    System.Threading.Thread.Sleep(30);
                    continue;
                }
                if (content.Width <= 0 || content.Height <= 0) { frame.Dispose(); continue; }
                long now = Environment.TickCount;
                bool need = cached == null || now - lastEncode >= 250;
                try {
                    if (need) { cached = Encode(frame); lastEncode = now; lastNewTick = Environment.TickCount; }
                } finally { frame.Dispose(); }
            } catch { System.Threading.Thread.Sleep(50); }
        }
    }

    public static byte[] GrabFrame() {
        if (pool == null) throw new InvalidOperationException("session not started");
        for (int i = 0; i < 67 && cached == null; i++) System.Threading.Thread.Sleep(15);
        if (cached == null) throw new InvalidOperationException("no frame yet");
        // 窗口销毁后帧池不再产新帧，旧缓存若继续返回会让调用方把
        // 死窗口误认为活流。超过 1.5s 无新帧视为窗口已关闭。
        if (Environment.TickCount - lastNewTick > 1500)
            throw new InvalidOperationException("window closed");
        return cached;
    }

    public static void StopSession() {
        draining = false;
        if (session != null) { try { session.Dispose(); } catch { } session = null; }
        if (pool != null) { try { pool.Dispose(); } catch { } pool = null; }
    }
}

public static class Native {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
}
