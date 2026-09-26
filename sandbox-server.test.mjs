import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const IS_WIN = process.platform === 'win32';
const root = fileURLToPath(new URL('.', import.meta.url));
/** 嵌入命令脚本的绝对路径统一转成前斜杠（Windows 反斜杠会被命令分词器当作转义符） */
const forward = (p) => p.replace(/\\/g, '/');
const serverSource = readFileSync(join(root, 'sandbox-server.mjs'), 'utf8');
assert.doesNotMatch(serverSource, /cmd(?:\.exe)?[^\n]*['"]\/c['"]/, 'the service must not execute commands through cmd /c');
const lockFile = join(root, '.sandbox-port');
const previousLock = existsSync(lockFile) ? readFileSync(lockFile, 'utf8') : null;
const port = 19000 + Math.floor(Math.random() * 1000);
const serviceToken = `test-token-${process.pid}`;
const approvalToken = `test-approval-token-${process.pid}`;
const fakeBin = mkdtempSync(join(tmpdir(), 'command-service-path-'));
writeFileSync(join(fakeBin, 'echo'), '#!/bin/sh\nprintf "PATH_HIJACKED\\n"\n');
chmodSync(join(fakeBin, 'echo'), 0o755);
const session = `confirmation-test-${process.pid}`;
const otherSession = `${session}-other`;
const createdSession = `${session}-created`;
const publicFile = `public-test-${process.pid}.txt`;
const missingPublicTarget = `missing-public-${process.pid}.txt`;
const timeoutMarker = `timeout-grandchild-${process.pid}.txt`;
const hostSecret = `host-secret-${process.pid}`;
const server = spawn(process.execPath, ['sandbox-server.mjs', String(port)], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    COMMAND_SERVICE_TOKEN: serviceToken,
    COMMAND_APPROVAL_TOKEN: approvalToken,
    PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ''}`,
    HOST_SECRET_SENTINEL: hostSecret,
    SSH_AUTH_SOCK: `/tmp/test-ssh-agent-${process.pid}`,
    GIT_ASKPASS: `/tmp/test-git-askpass-${process.pid}`,
  },
});

async function post(payload) {
  const response = await fetch(`http://127.0.0.1:${port}/exec`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Command-Service-Token': serviceToken },
    body: JSON.stringify(payload),
  });
  return response.json();
}

async function approve(confirmationRequestId, token = approvalToken) {
  const response = await fetch(`http://127.0.0.1:${port}/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Command-Service-Token': serviceToken,
      'X-Command-Approval-Token': token,
    },
    body: JSON.stringify({ confirmationRequestId }),
  });
  return { status: response.status, body: await response.json() };
}

async function waitUntilReady() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const result = await post({ script: 'echo ready', session });
      if (result.ok) return;
    } catch {
      await delay(50);
    }
  }
  throw new Error('local command service did not start');
}

try {
  await waitUntilReady();

  const unauthorizedResponse = await fetch(`http://127.0.0.1:${port}/exec`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ script: 'echo unauthorized' }),
  });
  assert.equal(unauthorizedResponse.status, 401, 'direct requests without the proxy token must be rejected');

  const missingExecSession = await post({ script: 'echo unauthorized-root' });
  assert.equal(missingExecSession.ok, false);
  assert.match(missingExecSession.message, /A valid session workspace is required/);

  const missingFileSessionResponse = await fetch(`http://127.0.0.1:${port}/file_list`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Command-Service-Token': serviceToken },
    body: '{}',
  });
  const missingFileSession = await missingFileSessionResponse.json();
  assert.equal(missingFileSessionResponse.status, 400);
  assert.equal(missingFileSession.ok, false);
  assert.match(missingFileSession.message, /A valid session workspace is required/);

  const sessionCreateResponse = await fetch(`http://127.0.0.1:${port}/session_create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Command-Service-Token': serviceToken },
    body: JSON.stringify({ session: createdSession }),
  });
  const sessionCreate = await sessionCreateResponse.json();
  assert.equal(sessionCreateResponse.status, 200);
  assert.equal(sessionCreate.ok, true);
  const createdPublicLink = join(root, 'sandbox_workspace', createdSession, 'public');
  assert.equal(lstatSync(createdPublicLink).isSymbolicLink(), true, 'session_create must add a public symlink');
  assert.equal(realpathSync(createdPublicLink), realpathSync(join(root, 'sandbox_workspace', 'public')));

  rmSync(join(root, 'sandbox_workspace', otherSession), { recursive: true, force: true });
  const missingDirectoryListResponse = await fetch(`http://127.0.0.1:${port}/file_list`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Command-Service-Token': serviceToken },
    body: JSON.stringify({ session: otherSession }),
  });
  const missingDirectoryList = await missingDirectoryListResponse.json();
  assert.equal(missingDirectoryListResponse.status, 200);
  assert.deepEqual(missingDirectoryList.files, []);
  assert.equal(existsSync(join(root, 'sandbox_workspace', otherSession)), false, 'listing must not create a missing session directory');

  const createOnWriteResponse = await fetch(`http://127.0.0.1:${port}/file_write`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Command-Service-Token': serviceToken },
    body: JSON.stringify({ session: otherSession, path: 'created.txt', content: 'created on write' }),
  });
  const createOnWrite = await createOnWriteResponse.json();
  assert.equal(createOnWriteResponse.status, 200);
  assert.equal(createOnWrite.ok, true);
  assert.equal(readFileSync(join(root, 'sandbox_workspace', otherSession, 'created.txt'), 'utf8'), 'created on write');
  const publicLink = join(root, 'sandbox_workspace', otherSession, 'public');
  assert.equal(lstatSync(publicLink).isSymbolicLink(), true, 'session creation must add a public symlink');
  assert.equal(realpathSync(publicLink), realpathSync(join(root, 'sandbox_workspace', 'public')));

  writeFileSync(join(root, 'sandbox_workspace', 'public', publicFile), 'shared read-only content');
  const publicReadResponse = await fetch(`http://127.0.0.1:${port}/file_read`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Command-Service-Token': serviceToken },
    body: JSON.stringify({ session: otherSession, path: `public/${publicFile}` }),
  });
  const publicRead = await publicReadResponse.json();
  assert.equal(publicReadResponse.status, 200);
  assert.equal(publicRead.content, 'shared read-only content');

  const publicListResponse = await fetch(`http://127.0.0.1:${port}/file_list`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Command-Service-Token': serviceToken },
    body: JSON.stringify({ session: otherSession }),
  });
  const publicList = await publicListResponse.json();
  assert.equal(publicListResponse.status, 200);
  assert.equal(publicList.files.includes(`public/${publicFile}`), true, 'file_list must expose public files through the session link');

  const publicWriteResponse = await fetch(`http://127.0.0.1:${port}/file_write`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Command-Service-Token': serviceToken },
    body: JSON.stringify({ session: otherSession, path: `public/${publicFile}`, content: 'must not change' }),
  });
  const publicWrite = await publicWriteResponse.json();
  assert.equal(publicWriteResponse.status, 400);
  assert.equal(publicWrite.ok, false);
  assert.match(publicWrite.message, /The public directory is read-only/);
  assert.equal(readFileSync(join(root, 'sandbox_workspace', 'public', publicFile), 'utf8'), 'shared read-only content');

  const publicDeleteResponse = await fetch(`http://127.0.0.1:${port}/session_delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Command-Service-Token': serviceToken },
    body: JSON.stringify({ session: 'public' }),
  });
  const publicDelete = await publicDeleteResponse.json();
  assert.equal(publicDeleteResponse.status, 400);
  assert.match(publicDelete.message, /The public workspace cannot be deleted/);
  assert.equal(readFileSync(join(root, 'sandbox_workspace', 'public', publicFile), 'utf8'), 'shared read-only content');

  const externalDir = mkdtempSync(join(tmpdir(), 'command-service-external-'));
  writeFileSync(join(externalDir, 'secret.txt'), 'outside');
  // Windows 用 junction（无需管理员/开发者模式，目标须为绝对路径）；Unix 用目录符号链接
  symlinkSync(externalDir, join(root, 'sandbox_workspace', otherSession, 'external'), IS_WIN ? 'junction' : 'dir');
  const externalReadResponse = await fetch(`http://127.0.0.1:${port}/file_read`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Command-Service-Token': serviceToken },
    body: JSON.stringify({ session: otherSession, path: 'external/secret.txt' }),
  });
  const externalRead = await externalReadResponse.json();
  assert.equal(externalReadResponse.status, 400);
  assert.equal(externalRead.ok, false);
  assert.match(externalRead.message, /Path is outside the workspace/);
  const absoluteReadResponse = await fetch(`http://127.0.0.1:${port}/file_read`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Command-Service-Token': serviceToken },
    body: JSON.stringify({ session: otherSession, path: forward(join(externalDir, 'secret.txt')) }),
  });
  const absoluteRead = await absoluteReadResponse.json();
  assert.equal(absoluteReadResponse.status, 400);
  assert.equal(absoluteRead.ok, false);
  assert.match(absoluteRead.message, /Invalid path/);
  const traversalReadResponse = await fetch(`http://127.0.0.1:${port}/file_read`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Command-Service-Token': serviceToken },
    body: JSON.stringify({ session: otherSession, path: `../public/${publicFile}` }),
  });
  const traversalRead = await traversalReadResponse.json();
  assert.equal(traversalReadResponse.status, 400);
  assert.equal(traversalRead.ok, false);
  assert.match(traversalRead.message, /Path must not contain \.\./);
  const externalWriteResponse = await fetch(`http://127.0.0.1:${port}/file_write`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Command-Service-Token': serviceToken },
    body: JSON.stringify({ session: otherSession, path: 'external/new/nested.txt', content: 'outside write' }),
  });
  const externalWrite = await externalWriteResponse.json();
  assert.equal(externalWriteResponse.status, 400);
  assert.equal(externalWrite.ok, false);
  assert.match(externalWrite.message, /Path is outside the workspace/);
  assert.equal(existsSync(join(externalDir, 'new')), false, 'unapproved writes must not create directories outside the workspace');
  rmSync(externalDir, { recursive: true, force: true });

  const allowlisted = await post({ script: 'echo allowlisted', session });
  assert.equal(allowlisted.ok, true, 'allowlisted commands must execute directly');
  assert.equal(allowlisted.output, 'allowlisted');

  const internalAbsoluteFile = join(root, 'sandbox_workspace', session, 'internal-absolute.txt');
  const internalAbsolute = await post({ script: `touch ${forward(internalAbsoluteFile)}`, session });
  assert.equal(internalAbsolute.ok, true, 'an absolute path inside the session must not require confirmation');
  assert.equal(existsSync(internalAbsoluteFile), true);

  const traversalPath = `../outside-${process.pid}.txt`;
  const traversalRequest = await post({ script: `touch ${traversalPath}`, session });
  assert.equal(traversalRequest.ok, false, 'parent traversal outside the session must be rejected');
  assert.match(traversalRequest.message, /Script write paths must stay within the current session workspace/);
  assert.equal(existsSync(join(root, 'sandbox_workspace', `outside-${process.pid}.txt`)), false);

  const externalShellFile = join(fakeBin, 'external-shell-write.txt');
  const externalPathRequest = await post({ script: `touch ${forward(externalShellFile)}`, session });
  assert.equal(externalPathRequest.ok, false, 'an absolute path outside the session must be rejected');
  assert.match(externalPathRequest.message, /Script write paths must stay within the current session workspace/);
  assert.equal(existsSync(externalShellFile), false, 'external writes must not run before approval');
  const externalCopyRequest = await post({
    script: `cp ${forward(join(root, '.gitignore'))} copied-from-external.txt`,
    session,
  });
  assert.equal(externalCopyRequest.ok, false, 'copying from an external source into the session must be rejected');
  assert.match(externalCopyRequest.message, /Script read paths must stay within the current session workspace/);
  assert.equal(existsSync(join(root, 'sandbox_workspace', session, 'copied-from-external.txt')), false);
  const publicPathRequest = await post({ script: `cat public/${publicFile}`, session });
  assert.equal(publicPathRequest.ok, true, 'reading through the public link must not require confirmation');
  assert.equal(publicPathRequest.output, 'shared read-only content');

  const absoluteExternalRead = await post({ script: `cat ${forward(join(root, '.gitignore'))}`, session });
  assert.equal(absoluteExternalRead.ok, false, 'reading an absolute external path must be rejected');
  assert.match(absoluteExternalRead.message, /Script read paths must stay within the current session workspace/);

  const copyToMissingPublicPath = await post({ script: `cp created.txt public/${missingPublicTarget}`, session: otherSession });
  assert.equal(copyToMissingPublicPath.ok, false, 'copying to public must be rejected');
  assert.match(copyToMissingPublicPath.message, /Script write paths must stay within the current session workspace/);
  assert.equal(existsSync(join(root, 'sandbox_workspace', 'public', missingPublicTarget)), false, 'the copy must not run before approval');

  // 非白名单改动型命令（mv / rm 等）同样先做路径分类：越界直接拒绝，不得进入确认通道
  const mvToPublic = await post({ script: `mv created.txt public/${missingPublicTarget}`, session: otherSession });
  assert.equal(mvToPublic.ok, false, 'moving a file into public must be rejected without a confirmation ticket');
  assert.equal(mvToPublic.needConfirm, undefined, 'an out-of-session write must not offer confirmation');
  assert.match(mvToPublic.message, /Script write paths must stay within the current session workspace/);
  assert.equal(existsSync(join(root, 'sandbox_workspace', otherSession, 'created.txt')), true, 'the source file must survive a rejected mv');
  assert.equal(existsSync(join(root, 'sandbox_workspace', 'public', missingPublicTarget)), false, 'the move must not run before approval');

  const mvFromPublic = await post({ script: `mv public/${publicFile} moved-from-public.txt`, session: otherSession });
  assert.equal(mvFromPublic.ok, false, 'moving a file out of public must be rejected (mv deletes its source)');
  assert.match(mvFromPublic.message, /Script write paths must stay within the current session workspace/);
  assert.equal(existsSync(join(root, 'sandbox_workspace', 'public', publicFile)), true, 'the public file must survive a rejected mv');

  const rmExternal = await post({ script: `rm ${forward(join(root, '.gitignore'))}`, session: otherSession });
  assert.equal(rmExternal.ok, false, 'removing an external file must be rejected');
  assert.equal(rmExternal.needConfirm, undefined, 'an out-of-session removal must not offer confirmation');
  assert.match(rmExternal.message, /Script write paths must stay within the current session workspace/);
  assert.equal(existsSync(join(root, '.gitignore')), true, 'the external file must survive a rejected rm');

  const mvInsideSession = await post({ script: 'mv created.txt renamed.txt', session: otherSession });
  assert.equal(mvInsideSession.needConfirm, true, 'an in-session mv is still a non-allowlisted command requiring confirmation');
  assert.equal(typeof mvInsideSession.confirmationRequestId, 'string');

  const genericDanglingLink = await post({ script: 'touch external/new-through-dangling-link.txt', session: otherSession });
  assert.equal(genericDanglingLink.ok, false, 'any symlink whose declared target is outside the session must be rejected even when its target is missing');
  assert.match(genericDanglingLink.message, /Script write paths must stay within the current session workspace/);

  symlinkSync(IS_WIN ? join(root, 'sandbox_workspace', otherSession, 'external') : 'external', join(root, 'sandbox_workspace', otherSession, 'alias'), IS_WIN ? 'junction' : 'dir');
  const chainedExternalLink = await post({ script: 'cat alias/secret.txt', session: otherSession });
  assert.equal(chainedExternalLink.ok, false, 'external reads through chained symlinks must be rejected');
  assert.match(chainedExternalLink.message, /Script read paths must stay within the current session workspace/);

  const optionEmbeddedPath = await post({
    script: `cp created.txt --target-directory=${forward(fakeBin)}`,
    session: otherSession,
  });
  assert.equal(optionEmbeddedPath.ok, false, 'external write targets embedded in option arguments must be rejected');
  assert.match(optionEmbeddedPath.message, /Script write paths must stay within the current session workspace/);

  const uniqExternalOutput = await post({
    script: `uniq -f 1 created.txt ${forward(join(fakeBin, 'uniq-output.txt'))}`,
    session: otherSession,
  });
  assert.equal(uniqExternalOutput.ok, false, 'optional external output files must be rejected');
  assert.match(uniqExternalOutput.message, /Script write paths must stay within the current session workspace/);

  const compactTargetDirectory = await post({
    script: `cp -t${forward(fakeBin)} created.txt`,
    session: otherSession,
  });
  assert.equal(compactTargetDirectory.ok, false, 'compact target-directory options must not bypass path restrictions');
  assert.match(compactTargetDirectory.message, /Script write paths must stay within the current session workspace/);

  const metacharacters = await post({ script: 'echo safe & literal | text > file', session });
  assert.equal(metacharacters.ok, true, 'shell metacharacters must remain literal arguments');
  assert.equal(metacharacters.output, 'safe & literal | text > file');
  assert.equal(existsSync(join(root, 'sandbox_workspace', session, 'file')), false, 'redirection must not create a file');

  const environmentRequest = await post({ script: 'env', session });
  assert.equal(environmentRequest.needConfirm, true, 'environment inspection must require confirmation');
  const environmentApproval = await approve(environmentRequest.confirmationRequestId);
  assert.equal(environmentApproval.body.ok, true);
  const environmentResult = await post({
    script: 'env',
    session,
    confirmationRequestId: environmentRequest.confirmationRequestId,
  });
  assert.equal(environmentResult.ok, true);
  const childEnvironment = Object.fromEntries(
    environmentResult.output.split('\n').map((line) => {
      const separator = line.indexOf('=');
      return separator === -1 ? [line, ''] : [line.slice(0, separator), line.slice(separator + 1)];
    }),
  );
  // 服务端只向子进程传入显式环境白名单。Windows 上 MSYS 工具（env.exe）会额外附加
  // Windows 系统环境块中的固定项（HOMEDRIVE/TEMP/SYSTEMROOT 等），因此断言为：
  // 白名单变量必须存在 + 敏感变量一律不得出现（而非精确等于 5 个）。
  for (const key of ['HOME', 'LANG', 'LC_ALL', 'PATH', 'TMPDIR']) {
    assert.ok(key in childEnvironment, `child environment must include ${key}`);
  }
  assert.deepEqual(
    Object.keys(childEnvironment).filter((key) => ![
      'HOME', 'LANG', 'LC_ALL', 'PATH', 'TMPDIR',
      'HOMEDRIVE', 'HOMEPATH', 'LOGONSERVER', 'SYSTEMDRIVE', 'SYSTEMROOT',
      'TEMP', 'TERM', 'USERDOMAIN', 'USERNAME', 'USERPROFILE', 'WINDIR',
    ].includes(key)).sort(),
    [],
    'child commands must not inherit any other environment variables',
  );
  // MSYS 会把沙箱 HOME/TMPDIR 渲染成 POSIX 风格（/tmp/tavern-harness-env-*/home），Unix 亦然
  assert.match(childEnvironment.HOME, /tavern-harness-env-[^/]+\/home$/);
  assert.match(childEnvironment.TMPDIR, /tavern-harness-env-[^/]+\/tmp$/);
  assert.notEqual(childEnvironment.HOME, process.env.HOME);
  assert.equal(environmentResult.output.includes(hostSecret), false);
  assert.equal(environmentResult.output.includes(serviceToken), false);
  assert.equal(environmentResult.output.includes(approvalToken), false);
  assert.equal(environmentResult.output.includes('SSH_AUTH_SOCK='), false);
  assert.equal(environmentResult.output.includes('GIT_ASKPASS='), false);

  const scriptAtCharacterLimit = `echo ${'x'.repeat(7995)}`;
  assert.equal(scriptAtCharacterLimit.length, 8000);
  const atCharacterLimit = await post({ script: scriptAtCharacterLimit, session });
  assert.equal(atCharacterLimit.ok, true, 'an 8000-character script must be accepted');

  const overCharacterLimit = await post({ script: `${scriptAtCharacterLimit}x`, session });
  assert.equal(overCharacterLimit.ok, false);
  assert.equal(overCharacterLimit.message, 'Script exceeds 8,000 characters');

  const scriptAtCommandLimit = Array.from({ length: 20 }, () => 'true').join(';');
  const atCommandLimit = await post({ script: scriptAtCommandLimit, session });
  assert.equal(atCommandLimit.ok, true, '20 parsed commands must be accepted');

  const overCommandLimit = await post({ script: `${scriptAtCommandLimit};true`, session });
  assert.equal(overCommandLimit.ok, false);
  assert.equal(overCommandLimit.message, 'Script contains more than 20 commands');

  for (const command of ['jq', 'bc']) {
    const result = await post({ script: `${command} --version`, session });
    assert.equal(result.needConfirm, undefined, `${command} must execute without confirmation`);
  }

  const confirmationRequiredCommands = [
    'node', 'npm', 'npx', 'git',
    'env', 'xargs', 'awk', 'find', 'sed', 'tar', 'zip', 'sort', 'openssl',
    'calc', 'type', 'gzip', 'gunzip', 'xz', 'unzip',
  ];
  for (const command of confirmationRequiredCommands) {
    const result = await post({ script: `${command} --version`, session });
    assert.equal(result.needConfirm, true, `${command} must require confirmation`);
    assert.equal(typeof result.confirmationRequestId, 'string');
  }

  const nonAllowlistedScript = 'command-that-does-not-exist';
  const nonAllowlisted = await post({ script: nonAllowlistedScript, session });
  assert.equal(nonAllowlisted.needConfirm, true, 'every non-allowlisted command must require confirmation');
  assert.equal(nonAllowlisted.confirmationReason, 'non_allowlisted');
  assert.equal(typeof nonAllowlisted.confirmationRequestId, 'string');

  const nonAllowlistedExternalPath = await post({ script: `node ${forward(externalShellFile)}`, session });
  assert.equal(nonAllowlistedExternalPath.ok, false);
  assert.equal(nonAllowlistedExternalPath.needConfirm, undefined, 'an explicit external path must be rejected before non-allowlisted confirmation');
  assert.match(nonAllowlistedExternalPath.message, /Script paths must stay within the current session workspace/);

  const externalPythonScript = await post({ script: `python3 ${forward(join(root, 'hello.py'))}`, session });
  assert.equal(externalPythonScript.ok, false, 'executing a Python script outside the session must be rejected');
  assert.equal(externalPythonScript.needConfirm, undefined, 'an external script path must not offer confirmation');
  assert.match(externalPythonScript.message, /Script paths must stay within the current session workspace/);

  const unapprovedNonAllowlisted = await post({
    script: nonAllowlistedScript,
    session,
    confirmationRequestId: nonAllowlisted.confirmationRequestId,
  });
  assert.equal(unapprovedNonAllowlisted.needConfirm, true, 'an unapproved request ID must not execute');

  const unauthorizedApproval = await approve(nonAllowlisted.confirmationRequestId, 'wrong-approval-token');
  assert.equal(unauthorizedApproval.status, 401, 'approval requires the separate approval token');

  const approval = await approve(nonAllowlisted.confirmationRequestId);
  assert.equal(approval.status, 200);
  assert.equal(approval.body.ok, true);
  const permittedNonAllowlisted = await post({
    script: nonAllowlistedScript,
    session,
    confirmationRequestId: nonAllowlisted.confirmationRequestId,
  });
  assert.equal(permittedNonAllowlisted.ok, false);
  assert.match(permittedNonAllowlisted.message, /Failed to execute command-that-does-not-exist/);
  assert.equal(permittedNonAllowlisted.needConfirm, undefined, 'an approved command must reach execution');

  const script = 'rm marker.txt';
  const forged = await post({ script, session, confirmed: true });
  assert.equal(forged.needConfirm, true, 'confirmed:true must not bypass confirmation');
  assert.equal(typeof forged.confirmationRequestId, 'string');

  const directRetry = await post({ script, session, confirmationRequestId: forged.confirmationRequestId });
  assert.equal(directRetry.needConfirm, true, 'a request ID alone must not prove user approval');

  const approvedRequest = await approve(forged.confirmationRequestId);
  assert.equal(approvedRequest.body.ok, true);
  const approved = await post({ script, session, confirmationRequestId: forged.confirmationRequestId });
  assert.equal(approved.ok, false);
  assert.match(approved.message, /marker\.txt/);
  assert.equal(approved.needConfirm, undefined, 'an approved request must reach command execution');

  const replayed = await post({ script, session, confirmationRequestId: forged.confirmationRequestId });
  assert.equal(replayed.needConfirm, true, 'an approved request must be single-use');

  const grandchildCode = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(timeoutMarker)}, 'alive'), 7000)`;
  const parentCode = `const { spawn } = require('node:child_process'); spawn(process.execPath, ['-e', ${JSON.stringify(grandchildCode)}], { stdio: 'ignore' }); setTimeout(() => {}, 20000)`;
  const timeoutScript = `node -e ${JSON.stringify(parentCode)}`;
  const timeoutConfirmation = await post({ script: timeoutScript, session });
  assert.equal(timeoutConfirmation.needConfirm, true);
  const timeoutApproval = await approve(timeoutConfirmation.confirmationRequestId);
  assert.equal(timeoutApproval.body.ok, true);
  const timedOut = await post({
    script: timeoutScript,
    session,
    confirmationRequestId: timeoutConfirmation.confirmationRequestId,
  });
  assert.equal(timedOut.ok, false);
  assert.match(timedOut.message, /Command timed out \(5000ms\)/);
  await delay(3000);
  assert.equal(
    existsSync(join(root, 'sandbox_workspace', session, timeoutMarker)),
    false,
    'timing out a command must terminate its descendant processes',
  );

  const changedScriptApproval = await approve(replayed.confirmationRequestId);
  assert.equal(changedScriptApproval.body.ok, true);
  const changedScript = await post({ script: 'rm other.txt', session, confirmationRequestId: replayed.confirmationRequestId });
  assert.equal(changedScript.needConfirm, true, 'an approval must be bound to the script');

  const changedSessionApproval = await approve(changedScript.confirmationRequestId);
  assert.equal(changedSessionApproval.body.ok, true);
  const changedSession = await post({ script, session: otherSession, confirmationRequestId: changedScript.confirmationRequestId });
  assert.equal(changedSession.needConfirm, true, 'an approval must be bound to the session');
} finally {
  server.kill('SIGKILL');
  rmSync(fakeBin, { recursive: true, force: true });
  rmSync(join(root, 'sandbox_workspace', session), { recursive: true, force: true });
  rmSync(join(root, 'sandbox_workspace', otherSession), { recursive: true, force: true });
  rmSync(join(root, 'sandbox_workspace', createdSession), { recursive: true, force: true });
  rmSync(join(root, 'sandbox_workspace', 'public', publicFile), { force: true });
  rmSync(join(root, 'sandbox_workspace', 'public', missingPublicTarget), { force: true });
  if (previousLock === null) rmSync(lockFile, { force: true });
  else writeFileSync(lockFile, previousLock);
}

console.log('local command policy tests passed');