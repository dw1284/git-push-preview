const vscode = require('vscode');
const process = require('process');
const {spawn} = require('child_process');

const getCurrentRemoteName = async function () {
  return _runCommand('git', ['remote']);
};

const getCurrentBranchName = async function() {
  return _runCommand('git', ['branch', '--show-current']);
};

const getUnpushedCommits = async function(remoteName) {
  const currentRemoteName = remoteName || await getCurrentRemoteName();
  const currentBranchIsTracked = await _currentBranchIsTracked();
  const unpushedCommitLog = currentBranchIsTracked
    ? await _runCommand('git', ['log', '@{u}..', '-z', '--name-status', '--parents'])
    : await _runCommand('git', ['log', 'HEAD', '--not', `--remotes=${currentRemoteName}`, '-z', '--name-status', '--parents']);
  return unpushedCommitLog !== ''
    ? _parseCommits(unpushedCommitLog)
    : [];
};

const getFileAtRevision = async function(revision, path) {
  return _runCommand('git', ['show', `${revision}:${path}`]);
};

const _currentBranchIsTracked = async function() {
  const output = await _runCommand('git', ['checkout']);
  return output.length > 0;
};

const _runCommand = async function(cmdText, args) {
  return new Promise((resolve, reject) => {
    const buffers = [];
    const child = spawn(cmdText, args, {cwd: vscode.workspace.workspaceFolders[0].uri.fsPath, shell: process.platform === 'win32'});
    child.stdout.on('data', b => buffers.push(b));
    child.stderr.on('data', b => buffers.push(b));
    child.on('error', console.log);
    child.on('exit', code => {
      const result = Buffer.concat(buffers).toString('utf8').trim();
      code ? reject(result) : resolve(result);
    });
  });
};

const _parseCommits = function(commitLog) {
  return commitLog.split(/\0\0/g).map(chunk => {
    const parts = chunk.split(/\n\n/g);
    const hashes = parts[0].match(/(commit\s)(.+?)(\n)/)[2].split(' ');
    return {
      hash: hashes[0],
      parentHash: hashes[1],
      author: parts[0].match(/(Author:\s)(.+?)(\n)/)[2],
      date: new Date(parts[0].match(/(Date:\s+)(.+)$/)[2]),
      message: parts[1].trim().replace('\n', '').replace('   ', ''),
      files: parts[2].match(/[ACDMRTUXB]\0.+?(?:\0|$)/g).map(file => {
        return {
          status: file.slice(0, 1),
          path: file.slice(2).replace('\0', ''),
          hash: hashes[0],
          parentHash: hashes[1]
        }
      })
    }
  });
};

module.exports = {getCurrentRemoteName, getCurrentBranchName, getUnpushedCommits, getFileAtRevision};
