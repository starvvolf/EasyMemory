/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
function runtimeEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) if (/^(path|systemroot|windir|temp|tmp|home|userprofile|localappdata|appdata|lang|lc_all)$/i.test(key)) env[key] = value;
  return { ...env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1', DOTNET_NOLOGO: '1', PYTHONIOENCODING: 'utf-8' };
}
async function findExecutable(name, configured) {
  if (configured) {
    if (!path.isAbsolute(configured) || /\.(cmd|bat|ps1)$/i.test(configured)) throw new Error(`${name}: 네이티브 실행 파일의 절대 경로를 지정하세요.`);
    await fs.access(configured); return fs.realpath(configured);
  }
  const paths = (process.env.PATH || process.env.Path || '').split(path.delimiter);
  for (const directory of paths) {
    if (!directory || /[\\/]WindowsApps(?:[\\/]|$)/i.test(directory)) continue;
    for (const suffix of process.platform === 'win32' ? ['.exe'] : ['']) {
      const file = path.join(directory, name + suffix);
      try { await fs.access(file); return await fs.realpath(file); } catch { /* next PATH entry */ }
    }
  }
  return null;
}
function probe(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, env: runtimeEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; const timer = setTimeout(() => { child.kill(); reject(new Error('런타임 확인 시간 초과')); }, 3000);
    const read = (chunk) => { output += chunk.toString(); if (output.length > 16384) { child.kill(); reject(new Error('런타임 확인 출력 초과')); } };
    child.stdout.on('data', read); child.stderr.on('data', read);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => { clearTimeout(timer); if (code === 0) resolve(output.trim()); else reject(new Error(output.slice(0, 200) || '런타임을 실행할 수 없습니다.')); });
  });
}
async function detectRuntime(language, settings = {}) {
  try {
    if (language === 'python') {
      const python = await findExecutable('python', settings.python) || await findExecutable('python3');
      if (!python) throw new Error('Python 3 실행 파일이 없습니다. 설치하거나 사용자 설정에 pythonExecutable 경로를 지정하세요. WindowsApps 별칭은 사용하지 않습니다.');
      const version = await probe(python, ['--version']);
      if (!/^Python 3\./.test(version)) throw new Error('Python 3가 필요합니다.');
      return { language, available: true, version, python };
    }
    if (language === 'java') {
      let java = await findExecutable('java', settings.java), javac = await findExecutable('javac', settings.javac);
      if (!java || !javac) throw new Error('Java 실행기와 javac 컴파일러가 포함된 JDK가 필요합니다.');
      // Oracle PATH entries can be forwarding executables. Launch the actual JDK
      // binary so cancellation owns the JVM PID, not a short-lived launcher PID.
      const properties = await probe(java, ['-XshowSettings:properties', '-version']);
      const home = /^\s*java\.home\s*=\s*(.+)$/m.exec(properties)?.[1]?.trim();
      if (home) {
        const nativeJava = path.join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
        await fs.access(nativeJava); java = await fs.realpath(nativeJava);
        if (!settings.javac) {
          const nativeJavac = path.join(home, 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac');
          await fs.access(nativeJavac); javac = await fs.realpath(nativeJavac);
        }
      }
      const [version, compilerVersion] = await Promise.all([probe(java, ['-version']), probe(javac, ['-version'])]);
      return { language, available: true, version: version.split('\n')[0] + ' / ' + compilerVersion, java, javac };
    }
    if (language === 'csharp') {
      const dotnet = await findExecutable('dotnet', settings.dotnet);
      if (!dotnet) throw new Error('.NET SDK가 필요합니다.');
      const sdks = await probe(dotnet, ['--list-sdks']);
      const choices = [...sdks.matchAll(/^(\d+\.\d+\.\d+)[^\n]*\[([^\]]+)\]/gm)];
      if (!choices.length) throw new Error('.NET 런타임만 있고 SDK가 없습니다. C# 컴파일에는 .NET SDK가 필요합니다.');
      const sdk = choices.at(-1), root = path.dirname(sdk[2]);
      if (Number(sdk[1].split('.')[0]) < 6) throw new Error('.NET SDK 6 이상이 필요합니다.');
      const compiler = path.join(sdk[2], sdk[1], 'Roslyn', 'bincore', 'csc.dll');
      const packRoot = path.join(root, 'packs', 'Microsoft.NETCore.App.Ref');
      const versions = (await fs.readdir(packRoot)).filter((v) => /^\d+\.\d+\.\d+$/.test(v)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      const runtimes = await probe(dotnet, ['--list-runtimes']);
      const version = versions.reverse().find((v) => runtimes.includes(`Microsoft.NETCore.App ${v.split('.')[0]}.`));
      if (!version) throw new Error('SDK 참조팩과 같은 주 버전의 .NET 런타임이 필요합니다.');
      const tfm = `net${version.split('.').slice(0, 2).join('.')}`;
      const references = path.join(packRoot, version, 'ref', tfm); await fs.access(compiler); await fs.access(references);
      return { language, available: true, version: `.NET SDK ${sdk[1]} / ${tfm}`, dotnet, compiler, references, tfm, runtimeVersion: version.split('.').slice(0, 2).join('.') + '.0' };
    }
    throw new Error('Python, C#, Java만 지원합니다.');
  } catch (error) { return { language, available: false, reason: error.message }; }
}
module.exports = { detectRuntime, runtimeEnv, findExecutable };
