using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;
internal static class Build { internal const string PayloadHash="fixture", Version="0.0.0"; }
internal static class SetupHarness {
    static void Check(bool value,string message) { if(!value)throw new Exception(message); }
    [STAThread] static int Main(string[] args) {
        string root=args[1], status=Path.Combine(root,"status.txt"), cancel=Path.Combine(root,"cancel.txt");
        if(args[0]=="writer") {
            var child=Process.Start(new ProcessStartInfo(args[2],"-e \"setTimeout(()=>{},15000)\""){UseShellExecute=false,CreateNoWindow=true});
            File.WriteAllText(Path.Combine(root,"child.pid"),child.Id.ToString());
            File.WriteAllText(status,"complete\nInstalled.");Console.WriteLine("Finished setup.");return 0;
        }
        if(args[0]=="cancel-writer") {
            File.WriteAllText(status,"working\nDownloading a synthetic fixture");
            var deadline=DateTime.UtcNow.AddSeconds(10);
            while(!File.Exists(cancel)&&DateTime.UtcNow<deadline)Thread.Sleep(20);
            if(!File.Exists(cancel))return 3;
            File.WriteAllText(status,"cancelled\nSetup cancelled.");return 2;
        }
        try {
            var own=Assembly.GetExecutingAssembly().Location;
            var info=new ProcessStartInfo(own,"writer \""+root+"\" \""+args[2]+"\""){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true};
            using(var process=Process.Start(info)) {
                process.OutputDataReceived+=delegate{};process.BeginOutputReadLine();
                var elapsed=Stopwatch.StartNew();Setup.WaitForSetup(process,status,cancel,new SetupOperation(),message=>{});
                Check(elapsed.ElapsedMilliseconds<7000,"Setup waited for a detached child's output pipe");
            }
            using(var child=Process.GetProcessById(Int32.Parse(File.ReadAllText(Path.Combine(root,"child.pid"))))) {
                Check(!child.HasExited,"Fixture did not retain the detached child");child.Kill();child.WaitForExit(5000);
            }
            File.Delete(status);
            var operation=new SetupOperation();
            using(var process=Process.Start(new ProcessStartInfo(own,"cancel-writer \""+root+"\""){UseShellExecute=false,CreateNoWindow=true})) {
                using(var timer=new System.Threading.Timer(_=>operation.CancelRequested=true,null,200,Timeout.Infinite)) {
                    bool cancelled=false;try{Setup.WaitForSetup(process,status,cancel,operation,message=>{});}catch(OperationCanceledException){cancelled=true;}
                    Check(cancelled&&process.HasExited,"Cancellation did not stop the setup process cooperatively");
                }
            }
            using(var form=new SetupWindow()) {
                var flags=BindingFlags.Instance|BindingFlags.NonPublic;
                var busy=new SetupOperation();typeof(SetupWindow).GetField("operation",flags).SetValue(form,busy);
                typeof(SetupWindow).GetField("running",flags).SetValue(form,true);
                var closing=new FormClosingEventArgs(CloseReason.UserClosing,false);
                typeof(Form).GetMethod("OnFormClosing",flags).Invoke(form,new object[]{closing});
                Check(closing.Cancel&&busy.CancelRequested,"The window close button did not request cancellation");
                typeof(SetupWindow).GetField("running",flags).SetValue(form,false);
                closing=new FormClosingEventArgs(CloseReason.UserClosing,false);
                typeof(Form).GetMethod("OnFormClosing",flags).Invoke(form,new object[]{closing});
                Check(!closing.Cancel,"A finished installer cannot close");
            }
            Console.WriteLine("Installer completion and cancellation checks passed");return 0;
        } catch(Exception error) { Console.Error.WriteLine(error);return 1; }
    }
}
