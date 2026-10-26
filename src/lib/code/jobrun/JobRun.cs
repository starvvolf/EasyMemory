// 작업 개체 채점 도우미 (2026-10-26, docs/DECISIONS.md "로컬 채점"). Windows only; built once with the csc.exe that
// ships with Windows (.NET Framework 4, so C# 5: no $"", no ?.).
//
//   jobrun.exe <stats.json> <cpuMs> <memMb> <program> [args...]
//
// Starts <program> suspended, puts it in a job object (job memory limit = memMb, kill everything when this helper
// ends), resumes it, and waits until no process is left in the job. stdin/stdout/stderr are passed straight through.
// CPU time is user + kernel of every process in the job, checked every few ms; over cpuMs the job is killed. The
// wall-clock limit stays in Node (a program waiting for input uses no CPU), which kills this helper and so the job.
// stats.json: {"exit":n,"cpuMs":n,"userMs":n,"kernelMs":n,"peakKb":n,"hit":"cpu"|"mem"|"","error":""}
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

static class JobRun {
  [StructLayout(LayoutKind.Sequential)] struct BasicLimit {
    public long PerProcessUserTimeLimit; public long PerJobUserTimeLimit; public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize; public UIntPtr MaximumWorkingSetSize; public uint ActiveProcessLimit;
    public UIntPtr Affinity; public uint PriorityClass; public uint SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong a, b, c, d, e, f; }
  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimit {
    public BasicLimit Basic; public IoCounters Io; public UIntPtr ProcessMemoryLimit; public UIntPtr JobMemoryLimit;
    public UIntPtr PeakProcessMemoryUsed; public UIntPtr PeakJobMemoryUsed;
  }
  [StructLayout(LayoutKind.Sequential)] struct Accounting {
    public long TotalUserTime; public long TotalKernelTime; public long ThisPeriodTotalUserTime; public long ThisPeriodTotalKernelTime;
    public uint TotalPageFaultCount; public uint TotalProcesses; public uint ActiveProcesses; public uint TotalTerminatedProcesses;
  }
  [StructLayout(LayoutKind.Sequential)] struct CompletionPort { public IntPtr CompletionKey; public IntPtr Port; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct StartupInfo {
    public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
    public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
    public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
  }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }

  [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attrs, string name);
  [DllImport("kernel32", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int cls, ref ExtendedLimit info, int size);
  [DllImport("kernel32", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int cls, ref CompletionPort info, int size);
  [DllImport("kernel32", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int cls, out Accounting info, int size, IntPtr ret);
  [DllImport("kernel32", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int cls, out ExtendedLimit info, int size, IntPtr ret);
  [DllImport("kernel32", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32", SetLastError = true)] static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32", SetLastError = true)] static extern IntPtr CreateIoCompletionPort(IntPtr file, IntPtr port, UIntPtr key, uint threads);
  [DllImport("kernel32", SetLastError = true)] static extern bool GetQueuedCompletionStatus(IntPtr port, out uint bytes, out UIntPtr key, out IntPtr overlapped, uint ms);
  [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CreateProcess(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string dir, ref StartupInfo si, out ProcessInfo pi);
  [DllImport("kernel32", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint ms);
  [DllImport("kernel32", SetLastError = true)] static extern IntPtr GetStdHandle(int which);
  [DllImport("kernel32", SetLastError = true)] static extern bool SetHandleInformation(IntPtr h, uint mask, uint flags);
  [DllImport("kernel32")] static extern bool CloseHandle(IntPtr h);

  const int ExtendedLimitInformation = 9, BasicAccountingInformation = 1, AssociateCompletionPortInformation = 7;
  const uint LIMIT_JOB_MEMORY = 0x200, LIMIT_KILL_ON_JOB_CLOSE = 0x2000, LIMIT_DIE_ON_UNHANDLED_EXCEPTION = 0x400;
  const uint MSG_ACTIVE_PROCESS_ZERO = 4, MSG_JOB_MEMORY_LIMIT = 10;
  const uint CREATE_SUSPENDED = 0x4, CREATE_UNICODE_ENVIRONMENT = 0x400;

  static string Quote(string a) {
    if (a.Length > 0 && a.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return a;
    var sb = new StringBuilder("\"");
    int slashes = 0;
    foreach (char c in a) {
      if (c == '\\') { slashes++; continue; }
      if (c == '"') { sb.Append('\\', slashes * 2 + 1); sb.Append('"'); }
      else { sb.Append('\\', slashes); sb.Append(c); }
      slashes = 0;
    }
    sb.Append('\\', slashes * 2); sb.Append('"');
    return sb.ToString();
  }

  static void Write(string file, uint exit, long user, long kernel, long peak, string hit, string error) {
    var json = "{\"exit\":" + exit + ",\"cpuMs\":" + ((user + kernel) / 10000) + ",\"userMs\":" + (user / 10000) + ",\"kernelMs\":" + (kernel / 10000)
      + ",\"peakKb\":" + (peak / 1024) + ",\"hit\":\"" + hit + "\",\"error\":\"" + error.Replace("\\", "\\\\").Replace("\"", "'") + "\"}";
    File.WriteAllText(file, json);
  }

  static int Main(string[] args) {
    if (args.Length < 4) { Console.Error.WriteLine("usage: jobrun <stats.json> <cpuMs> <memMb> <program> [args...]"); return 2; }
    string stats = args[0]; long cpuMs = long.Parse(args[1]); long memMb = long.Parse(args[2]);
    var cmd = new StringBuilder();
    for (int i = 3; i < args.Length; i++) { if (i > 3) cmd.Append(' '); cmd.Append(Quote(args[i])); }

    IntPtr job = CreateJobObject(IntPtr.Zero, null);
    var limit = new ExtendedLimit();
    limit.Basic.LimitFlags = LIMIT_JOB_MEMORY | LIMIT_KILL_ON_JOB_CLOSE | LIMIT_DIE_ON_UNHANDLED_EXCEPTION;
    limit.JobMemoryLimit = new UIntPtr((ulong)memMb * 1024 * 1024);
    if (!SetInformationJobObject(job, ExtendedLimitInformation, ref limit, Marshal.SizeOf(typeof(ExtendedLimit)))) {
      Write(stats, 0, 0, 0, 0, "", "SetInformationJobObject: " + new Win32Exception().Message); return 3;
    }
    IntPtr port = CreateIoCompletionPort(new IntPtr(-1), IntPtr.Zero, UIntPtr.Zero, 1);
    var assoc = new CompletionPort(); assoc.CompletionKey = job; assoc.Port = port;
    SetInformationJobObject(job, AssociateCompletionPortInformation, ref assoc, Marshal.SizeOf(typeof(CompletionPort)));

    var si = new StartupInfo(); si.cb = Marshal.SizeOf(typeof(StartupInfo)); si.dwFlags = 0x100; // STARTF_USESTDHANDLES
    si.hStdInput = GetStdHandle(-10); si.hStdOutput = GetStdHandle(-11); si.hStdError = GetStdHandle(-12);
    foreach (var h in new[] { si.hStdInput, si.hStdOutput, si.hStdError }) SetHandleInformation(h, 1, 1);
    ProcessInfo pi;
    if (!CreateProcess(null, cmd, IntPtr.Zero, IntPtr.Zero, true, CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT, IntPtr.Zero, null, ref si, out pi)) {
      Write(stats, 0, 0, 0, 0, "", "CreateProcess: " + new Win32Exception().Message); return 3;
    }
    if (!AssignProcessToJobObject(job, pi.hProcess)) {
      string why = new Win32Exception().Message;
      ResumeThread(pi.hThread); // still run it, just without limits; Node's wall clock still applies
      Write(stats, 0, 0, 0, 0, "", "AssignProcessToJobObject: " + why);
      WaitForSingleObject(pi.hProcess, 0xFFFFFFFF); uint c0; GetExitCodeProcess(pi.hProcess, out c0); return (int)c0;
    }
    ResumeThread(pi.hThread); CloseHandle(pi.hThread);

    string hit = ""; Accounting acc = new Accounting();
    while (true) {
      uint msg; UIntPtr key; IntPtr ov;
      bool got = GetQueuedCompletionStatus(port, out msg, out key, out ov, 5);
      if (got && msg == MSG_JOB_MEMORY_LIMIT && hit == "") hit = "mem";
      QueryInformationJobObject(job, BasicAccountingInformation, out acc, Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero);
      if (hit == "" && (acc.TotalUserTime + acc.TotalKernelTime) / 10000 > cpuMs) { hit = "cpu"; TerminateJobObject(job, 1); }
      if (got && msg == MSG_ACTIVE_PROCESS_ZERO) break;
      if (!got && acc.ActiveProcesses == 0 && acc.TotalProcesses > 0) break;
    }
    WaitForSingleObject(pi.hProcess, 2000);
    uint exit; GetExitCodeProcess(pi.hProcess, out exit);
    QueryInformationJobObject(job, BasicAccountingInformation, out acc, Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero);
    ExtendedLimit after; QueryInformationJobObject(job, ExtendedLimitInformation, out after, Marshal.SizeOf(typeof(ExtendedLimit)), IntPtr.Zero);
    Write(stats, exit, acc.TotalUserTime, acc.TotalKernelTime, (long)after.PeakJobMemoryUsed.ToUInt64(), hit, "");
    return 0;
  }
}
