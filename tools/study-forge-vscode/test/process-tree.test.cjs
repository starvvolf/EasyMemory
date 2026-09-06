/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const { LanguageRunner } = require('../language-runner');
const { detectRuntime } = require('../local-runtimes');
const { analyzeSource, confirmExecution } = require('../execution-contract');
function alive(pid) { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } }
const sources = {
  python: 'import sys,subprocess,time\nif len(sys.argv)>1:\n    time.sleep(60)\nelse:\n    child=subprocess.Popen([sys.executable,__file__,"child"])\n    print(child.pid,flush=True)\n    time.sleep(60)\n',
  java: 'public class Main { public static void main(String[] args) throws Exception { if(args.length>0) { Thread.sleep(60000); return; } Process child = new ProcessBuilder(System.getProperty("java.home")+"/bin/java", "-cp", System.getProperty("java.class.path"), "Main", "child").inheritIO().start(); System.out.println(child.pid()); System.out.flush(); Thread.sleep(60000); } }',
  csharp: 'using System; public class Program { public static void Main(string[] args) { if(args.Length>0) { System.Threading.Thread.Sleep(60000); return; } var info=new System.Diagnostics.ProcessStartInfo(Environment.ProcessPath!); info.UseShellExecute=false; info.ArgumentList.Add(System.Reflection.Assembly.GetExecutingAssembly().Location); info.ArgumentList.Add("child"); var child=System.Diagnostics.Process.Start(info)!; Console.WriteLine(child.Id); Console.Out.Flush(); System.Threading.Thread.Sleep(60000); } }',
};
for (const language of ['python', 'java', 'csharp']) for (const stop of ['timeout', 'stopped']) {
  test(`${language}: ${stop} 시 자손 프로세스도 종료`, { timeout: 20000 }, async (t) => {
    const runtime = await detectRuntime(language, { python: process.env.STUDY_FORGE_TEST_PYTHON });
    if (!runtime.available) { t.skip(runtime.reason); return; }
    const source = sources[language], analysis = analyzeSource(language, source), runner = new LanguageRunner();
    let timer;
    const examples = [{ input: '', expectedOutput: '' }];
    const execution = confirmExecution(language, source, { mode: 'stdio', mainClass: analysis.className }, examples);
    const result = await runner.runSource({ source, language, runtime, execution, examples }, undefined,
      { timeoutMs: 1200, ...(stop === 'stopped' ? { onSpawn: () => { timer = setTimeout(() => runner.stop(), 900); } } : {}) });
    clearTimeout(timer);
    assert.equal(result[0].status, stop, JSON.stringify(result));
    const pid = Number(result[0].actualOutput.trim()); assert.ok(Number.isSafeInteger(pid) && pid > 0, JSON.stringify(result));
    const remained = alive(pid);
    // Cleanup is limited to the exact child PID emitted by this synthetic fixture.
    if (remained) process.kill(pid, 'SIGKILL');
    assert.equal(remained, false, `fixture child ${pid} survived termination`);
  });
}
