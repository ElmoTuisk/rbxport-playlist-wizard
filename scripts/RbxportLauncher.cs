using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;

// A Windows shortcut must not depend on allocating a PowerShell console.
internal static class RbxportLauncher {
    [STAThread]
    private static int Main(string[] args) {
        bool quiet = false, pause = false;
        foreach (string arg in args) {
            if (arg.Equals("-PauseAutomatic", StringComparison.OrdinalIgnoreCase)) pause = true;
            else if (arg.Equals("-NoWindow", StringComparison.OrdinalIgnoreCase)) quiet = true;
            else return 2;
        }
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string status = Path.Combine(root, "launch-status.txt");
        try {
            File.WriteAllText(status, "Starting " + DateTime.UtcNow.ToString("O"));
            string script = Path.Combine(root, "Start-Rbxport.ps1");
            if (!File.Exists(script) || script.IndexOf('"') >= 0) throw new IOException("The rbxport launcher helper is missing. Run Configure-Rbxport-Startup.ps1 again.");
            var start = new ProcessStartInfo {
                FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe"),
                Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + script + "\" -NoWindow" + (pause ? " -PauseAutomatic" : ""),
                WorkingDirectory = root,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            var output = new StringBuilder();
            using (var drained = new CountdownEvent(2))
            using (var child = new Process { StartInfo = start }) {
                DataReceivedEventHandler receive = (sender, e) => {
                    if (e.Data == null) { try { drained.Signal(); } catch (ObjectDisposedException) { } }
                    else lock (output) { if (output.Length < 65536) output.AppendLine(e.Data); }
                };
                child.OutputDataReceived += receive;
                child.ErrorDataReceived += receive;
                if (!child.Start()) throw new IOException("Windows could not start the rbxport helper.");
                child.BeginOutputReadLine(); child.BeginErrorReadLine();
                // This overload follows the helper itself, not descendant services or pipe EOF.
                if (!child.WaitForExit(180000)) throw new TimeoutException("rbxport startup has not finished. Check its window and try again after the current launch ends.");
                // Drain short final errors, but never wait indefinitely for an inherited pipe.
                drained.Wait(1000);
                if (child.ExitCode == 3) {
                    File.WriteAllText(status, "Closed " + DateTime.UtcNow.ToString("O"));
                    return 0;
                }
                if (child.ExitCode != 0) {
                    lock (output) File.WriteAllText(Path.Combine(root, "launch-error.log"), output.ToString());
                    throw new IOException("rbxport or an enabled add-on could not start. Details are saved in " + Path.Combine(root, "launch-error.log"));
                }
            }
            File.WriteAllText(status, "Ready " + DateTime.UtcNow.ToString("O"));
            string previousError = Path.Combine(root, "launch-error.log");
            if (File.Exists(previousError)) File.Delete(previousError);
            return 0;
        } catch (Exception error) {
            try { File.WriteAllText(status, "Failed " + DateTime.UtcNow.ToString("O") + Environment.NewLine + error.Message); } catch { }
            if (!quiet) MessageBox.Show(error.Message, "rbxport add-ons", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
