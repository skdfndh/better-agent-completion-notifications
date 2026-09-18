import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectPath = process.cwd();
const installScript = join(projectPath, "src", "native", "install-autostart.ps1");
const supervisorScript = join(projectPath, "src", "native", "reminder-supervisor.ps1");
const watchdogScript = join(projectPath, "src", "native", "reminder-watchdog.ps1");

function toPowerShellLiteral(value: string) {
  return value.replaceAll("'", "''");
}

async function runPowerShell(command: string) {
  return execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    windowsHide: true,
  });
}

async function waitFor(condition: () => Promise<boolean>, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("等待监督器重启守护器超时");
}

test("安装脚本创建可重启的登录守护任务", async () => {
  const taskName = `CodexTaskReminderWatchdog-Test-${randomUUID()}`;
  const escapedInstallScript = toPowerShellLiteral(installScript);
  const escapedProjectPath = toPowerShellLiteral(projectPath);

  try {
    const { stdout } = await runPowerShell(`
      $ErrorActionPreference = 'Stop'
      & '${escapedInstallScript}' -WorkspacePath '${escapedProjectPath}' -TaskName '${taskName}' -SkipShortcuts -SkipStart
      $task = Get-ScheduledTask -TaskName '${taskName}'
      [PSCustomObject]@{
        hasLogonTrigger = @($task.Triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger' }).Count -eq 1
        restartCount = [int]$task.Settings.RestartCount
        restartInterval = [string]$task.Settings.RestartInterval
        arguments = [string]$task.Actions[0].Arguments
      } | ConvertTo-Json -Compress -Depth 10
    `);
    const task = JSON.parse(stdout.trim());

    assert.equal(task.hasLogonTrigger, true);
    assert.equal(task.restartCount, 3);
    assert.equal(task.restartInterval, "PT1M");
    assert.match(task.arguments, /reminder-supervisor\.ps1/);
  } finally {
    await runPowerShell(`
      Stop-ScheduledTask -TaskName '${taskName}' -ErrorAction SilentlyContinue
      Unregister-ScheduledTask -TaskName '${taskName}' -Confirm:$false -ErrorAction SilentlyContinue
      exit 0
    `);
  }
});

test("监督器在守护器退出后重新启动它", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-task-reminder-supervisor-"));
  const workerScript = join(directory, "test-watchdog.ps1");
  const startsPath = join(directory, "starts.log");
  await writeFile(
    workerScript,
    "param([string]$WorkspacePath)\nAdd-Content -LiteralPath (Join-Path $WorkspacePath 'starts.log') 'started'\n",
    "utf8",
  );
  const supervisor = spawn(
    "powershell.exe",
    ["-NoProfile", "-File", supervisorScript, "-WatchdogScript", workerScript, "-WorkspacePath", directory, "-RestartDelaySeconds", "1"],
    { windowsHide: true },
  );

  try {
    await waitFor(async () => {
      try {
        return (await readFile(startsPath, "utf8")).trim().split("\n").length >= 2;
      } catch {
        return false;
      }
    }, 5_000);
    const starts = (await readFile(startsPath, "utf8")).trim().split("\n");
    assert.ok(starts.length >= 2);
  } finally {
    supervisor.kill();
    await rm(directory, { recursive: true, force: true });
  }
});

test("守护器启动时接管已有的受管进程", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-task-reminder-adopt-"));
  const workerScript = join(directory, "managed-worker.ps1");
  await writeFile(workerScript, "Start-Sleep -Seconds 10\n", "utf8");
  const worker = spawn("powershell.exe", ["-NoProfile", "-File", workerScript], { windowsHide: true });
  const escapedWatchdogScript = toPowerShellLiteral(watchdogScript);
  const escapedWorkerScript = toPowerShellLiteral(workerScript);

  try {
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    const { stdout } = await runPowerShell(`
      $env:TEST_REMINDER_WATCHDOG_NO_RUN = '1'
      . '${escapedWatchdogScript}'
      (Get-ManagedProcess -ScriptPath '${escapedWorkerScript}').Id
    `);
    assert.equal(Number(stdout.trim()), worker.pid);
  } finally {
    worker.kill();
    await rm(directory, { recursive: true, force: true });
  }
});

test("安装脚本在指定桌面目录创建工作台入口", async () => {
  const taskName = `CodexTaskReminderWatchdog-Test-${randomUUID()}`;
  const desktopPath = await mkdtemp(join(tmpdir(), "codex-task-reminder-shortcut-"));
  const escapedInstallScript = toPowerShellLiteral(installScript);
  const escapedProjectPath = toPowerShellLiteral(projectPath);
  const escapedDesktopPath = toPowerShellLiteral(desktopPath);

  try {
    await runPowerShell(`
      $ErrorActionPreference = 'Stop'
      & '${escapedInstallScript}' -WorkspacePath '${escapedProjectPath}' -TaskName '${taskName}' -DesktopPath '${escapedDesktopPath}' -SkipStart
    `);
    const shortcut = await stat(join(desktopPath, "Codex 提醒工作台.lnk"));
    assert.equal(shortcut.isFile(), true);
  } finally {
    await runPowerShell(`
      Stop-ScheduledTask -TaskName '${taskName}' -ErrorAction SilentlyContinue
      Unregister-ScheduledTask -TaskName '${taskName}' -Confirm:$false -ErrorAction SilentlyContinue
      exit 0
    `);
    await rm(desktopPath, { recursive: true, force: true });
  }
});
