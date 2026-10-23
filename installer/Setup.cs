using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Windows.Forms;

internal sealed class SetupOperation { internal volatile bool CancelRequested; }
internal static class Setup {
    [STAThread] static int Main(string[] args) {
        try {
            if (args.Length == 1 && args[0] == "--verify-payload") { using (var payload = Payload()) { Validate(payload, null); } return 0; }
            if (args.Length != 0) throw new Exception("Open this setup file without command-line arguments.");
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupWindow()); return 0;
        } catch (Exception error) {
            if (args.Length == 0) MessageBox.Show(error.Message, "Playlist Wizard setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
    static MemoryStream Payload() {
        var bytes = new MemoryStream();
        using (var resource = Assembly.GetExecutingAssembly().GetManifestResourceStream("Payload.zip")) {
            if (resource == null) throw new Exception("Setup payload is missing."); resource.CopyTo(bytes);
        }
        bytes.Position = 0;
        using (var sha = SHA256.Create()) {
            if (BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant() != Build.PayloadHash) throw new Exception("Setup payload verification failed.");
        }
        bytes.Position = 0; return bytes;
    }
    static void Validate(Stream bytes, string destination) {
        using (var archive = new ZipArchive(bytes, ZipArchiveMode.Read, true)) {
            bool installer = false;
            foreach (var item in archive.Entries) {
                string name = item.FullName.Replace('/', '\\');
                if (Path.IsPathRooted(name) || name.Contains(":") || Array.Exists(name.Split('\\'), part => part == "..")) throw new Exception("Unsafe setup entry.");
                if (name == "Install-Playlist-Wizard.ps1") installer = true;
                if (destination == null) continue;
                string path = Path.GetFullPath(Path.Combine(destination, name));
                if (!path.StartsWith(destination + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new Exception("Unsafe setup path.");
                if (name.EndsWith("\\")) { Directory.CreateDirectory(path); continue; }
                Directory.CreateDirectory(Path.GetDirectoryName(path));
                using (var source = item.Open()) using (var file = new FileStream(path, FileMode.CreateNew)) { source.CopyTo(file); }
            }
            if (!installer) throw new Exception("Setup entry point is missing.");
        }
    }
    internal static void Install(bool automatic, string existing, SetupOperation operation, Action<string> progress) {
        string temp = Path.GetFullPath(Path.Combine(Path.GetTempPath(), "playlist-wizard-setup-" + Guid.NewGuid().ToString("N")));
        Directory.CreateDirectory(temp);
        try {
            using (var payload = Payload()) { Validate(payload, temp); }
            string shell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), @"System32\WindowsPowerShell\v1.0\powershell.exe");
            if (existing != null && (!Path.IsPathRooted(existing) || existing.Contains("\""))) throw new Exception("Invalid installation folder.");
            string status = Path.Combine(temp, "setup-status.txt"), cancel = Path.Combine(temp, "setup-cancel.txt");
            var info = new ProcessStartInfo(shell, "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + Path.Combine(temp, "Install-Playlist-Wizard.ps1") + "\" -StatusFile \"" + status + "\" -CancellationFile \"" + cancel + "\" -NoLaunch" + (automatic ? " -StartWithRbxport" : "") + (existing == null ? "" : " -ExistingDirectory \"" + existing.TrimEnd('\\') + "\""));
            info.UseShellExecute = false; info.CreateNoWindow = true; info.WindowStyle = ProcessWindowStyle.Hidden;
            // Detached services can inherit pipe handles. Never wait for their output EOF.
            // Progress/errors use a private status file, and completion follows the setup PID.
            using (var process = new Process()) {
                process.StartInfo = info;
                process.Start(); WaitForSetup(process, status, cancel, operation, progress);
            }
        } finally {
            string parent = Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (temp.StartsWith(parent, StringComparison.OrdinalIgnoreCase) && Path.GetFileName(temp).StartsWith("playlist-wizard-setup-")) {
                // Every file was extracted here; never follow a junction during cleanup.
                try { DeleteTemporary(temp); } catch { /* A locked temporary file can remain for Windows cleanup. */ }
            }
        }
    }
    internal static void WaitForSetup(Process process, string status, string cancel, SetupOperation operation, Action<string> progress) {
        string state = "", message = "", previous = "";
        bool exited;
        do {
            if (operation.CancelRequested && !File.Exists(cancel)) File.WriteAllText(cancel, "cancel");
            exited = process.WaitForExit(100);
            try {
                if (File.Exists(status)) {
                    var lines = File.ReadAllLines(status);
                    if (lines.Length >= 2) { state = lines[0]; message = String.Join(" ", lines, 1, lines.Length - 1); }
                }
            } catch (IOException) { /* Retry a status write in progress. */ }
            string display = operation.CancelRequested ? "Closing setup safely. Finishing any file installation already in progress…" : message;
            if (!String.IsNullOrWhiteSpace(display) && display != previous) { progress(display); previous = display; }
        } while (!exited);
        if (state == "cancelled") throw new OperationCanceledException(message);
        if (process.ExitCode != 0 || state != "complete") throw new Exception(String.IsNullOrWhiteSpace(message) ? "Setup did not complete. Your saved data was kept. Please try again." : message);
    }
    static void DeleteTemporary(string directory) {
        if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0) return;
        foreach (string child in Directory.GetDirectories(directory)) DeleteTemporary(child);
        foreach (string file in Directory.GetFiles(directory)) if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) == 0) File.Delete(file);
        if (Directory.GetFileSystemEntries(directory).Length == 0) Directory.Delete(directory);
    }
}

internal sealed class SetupWindow : Form {
    readonly CheckBox automatic = new CheckBox();
    readonly Button install = new Button();
    readonly Label status = new Label();
    readonly LinkLabel choose = new LinkLabel();
    readonly Button cancel = new Button();
    SetupOperation operation;
    bool closeRequested;
    string existing;
    bool running;
    internal SetupWindow() {
        Text = "Playlist Wizard setup"; ClientSize = new Size(540, 370); FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false; StartPosition = FormStartPosition.CenterScreen; Font = new Font("Segoe UI", 10);
        var title = new Label { Text = "Install or update Playlist Wizard", Font = new Font("Segoe UI", 19, FontStyle.Bold), Location = new Point(24, 20), Size = new Size(490, 42) };
        var intro = new Label { Text = "Keeps your music and saved settings. Close rbxport first.\nThe checked option below updates your rbxport shortcuts\nand enables its local connection. Internet is required.", Location = new Point(26, 76), Size = new Size(486, 78) };
        automatic.Text = "Show Playlist Wizard when rbxport opens"; automatic.Checked = true; automatic.Location = new Point(26, 158); automatic.Size = new Size(480, 28);
        choose.Text = "Choose existing folder (optional)"; choose.Location = new Point(26, 198); choose.Size = new Size(485, 28);
        choose.LinkClicked += delegate { using (var dialog = new FolderBrowserDialog { Description = "Select your existing Playlist Wizard folder", ShowNewFolderButton = false }) { if (dialog.ShowDialog(this) == DialogResult.OK) { existing = dialog.SelectedPath; status.Text = "Update: " + existing; } } };
        status.Text = "Version " + Build.Version + " · No administrator access required"; status.Location = new Point(26, 240); status.Size = new Size(485, 66);
        install.Text = "Install / Update"; install.Location = new Point(374, 322); install.Size = new Size(140, 34);
        cancel.Text = "Cancel"; cancel.Location = new Point(256, 322); cancel.Size = new Size(108, 34); cancel.Click += delegate { Close(); };
        Controls.AddRange(new Control[] { title, intro, automatic, choose, status, cancel, install });
        CancelButton = cancel;
        FormClosing += delegate(object sender, FormClosingEventArgs e) {
            if (running) { e.Cancel = true; closeRequested = true; operation.CancelRequested = true; cancel.Enabled = false; status.Text = "Closing setup safely…"; }
        };
        install.Click += delegate {
            if (install.Text == "Close") { Close(); return; }
            bool attach = automatic.Checked; operation = new SetupOperation(); closeRequested = false; running = true; install.Enabled = false; automatic.Enabled = false; choose.Enabled = false; status.Text = "Preparing setup…";
            var worker = new BackgroundWorker();
            worker.DoWork += delegate { Setup.Install(attach, existing, operation, line => { BeginInvoke((Action)(() => status.Text = line)); }); };
            worker.RunWorkerCompleted += delegate(object sender, RunWorkerCompletedEventArgs e) {
                running = false; install.Enabled = true; cancel.Enabled = true;
                if (closeRequested) { worker.Dispose(); Close(); return; }
                if (e.Error != null) { status.Text = "Setup could not finish."; automatic.Enabled = true; choose.Enabled = true; MessageBox.Show(this, e.Error.Message, "Playlist Wizard setup", MessageBoxButtons.OK, MessageBoxIcon.Error); }
                else { status.Text = attach ? "Installed. Open rbxport from its Start Menu or Desktop shortcut. Playlist Wizard closes with it." : "Installed. Open the Playlist Wizard shortcut. Playlist Wizard closes with rbxport."; install.Text = "Close"; cancel.Visible = false; }
                worker.Dispose();
            };
            worker.RunWorkerAsync();
        };
    }
}
