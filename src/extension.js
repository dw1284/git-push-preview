const vscode = require('vscode');
const path = require('path');
const gitUtils = require('./git-utils');

function activate(context) {
  let currentPanel;
  
  // Virtual document provider (prevents us from having to mess with the filesystem when launching the diff editor)
  const diffProvider = new class {
    async provideTextDocumentContent(uri) {
      // Params passed into us
      const revision = uri.path.split('@@')[0];
      const path = uri.path.split('@@')[1];
      let content = '';
      try {
        // Get the file content out of git
        content = await gitUtils.getFileAtRevision(revision, path);
      } finally {
        return content; // Will be blank for newly added and deleted files
      }
		}
  };
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('diff', diffProvider));
  
  context.subscriptions.push(vscode.commands.registerCommand('git.pushWithPreview', async () => {
    try {
      const columnToShowIn = vscode.window.activeTextEditor?.viewColumn;
    
      if (currentPanel) {
        currentPanel.reveal(columnToShowIn);
      } else {
        currentPanel = vscode.window.createWebviewPanel(
          'pushWithPreview',
          'Push Commits',
          vscode.ViewColumn.One,
          {enableScripts: true}
        );
        
        currentPanel.webview.onDidReceiveMessage(async ({message, content}) => {
          switch (message) {
            case 'getCurrentWorkspaceName':
              const currentWorkspaceName = vscode.workspace.workspaceFolders[0].name;
              currentPanel.webview.postMessage({message: 'receivedCurrentWorkspaceName', content: {currentWorkspaceName}});
              return;
            case 'getCurrentRemoteName':
              const currentRemoteName = await gitUtils.getCurrentRemoteName();
              currentPanel.webview.postMessage({message: 'receivedCurrentRemoteName', content: {currentRemoteName}});
              return;
            case 'getCurrentBranchName':
              const currentBranchName = await gitUtils.getCurrentBranchName();
              currentPanel.webview.postMessage({message: 'receivedCurrentBranchName', content: {currentBranchName}});
              return;
            case 'getUnpushedCommits':
              const unpushedCommits = await gitUtils.getUnpushedCommits();
              currentPanel.webview.postMessage({message: 'receivedUnpushedCommits', content: {unpushedCommits}});
              return;
            case 'launchDiff':
              const uri1 = vscode.Uri.parse(`diff:${content.parentHash}@@${content.path}`);
              const uri2 = vscode.Uri.parse(`diff:${content.hash}@@${content.path}`);
              const label = path.basename(content.path);
              const viewOptions = {viewColumn: vscode.ViewColumn.Beside};
              // These URIs will retrieve their content via the diffProvider class that we provided above
              // They will then launch in a diff editor for the user to review
              vscode.commands.executeCommand('vscode.diff', uri1, uri2, label, viewOptions);
              return;
            case 'push':
              vscode.commands.executeCommand('git.push');
              currentPanel.dispose();
              return;
            case 'cancel':
              currentPanel.dispose();
              return;
          }
        }, undefined, context.subscriptions);
        
        currentPanel.onDidDispose(() => {
          currentPanel = null;
        }, undefined, context.subscriptions);
        
        currentPanel.webview.html = await getWebviewContent(context, currentPanel.webview);
      }
    } catch (e) {
      vscode.window.showErrorMessage(e.message);
    }
  }));
}

async function getWebviewContent(context, webview) {
  const scriptUri = webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'assets', 'scripts', 'webview.js')));
  const stylesUri = webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'assets', 'styles', 'webview.css')));
  
  return `<!DOCTYPE html>
          <html lang="en">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; script-src ${webview.cspSource}; style-src ${webview.cspSource};"/>
            <title>Push Preview</title>
            <link href="${stylesUri}" rel="stylesheet">
          </head>
          <body>
            <main-content>
              <commits></commits>
              <info-panel>
                <tree-header>Files</tree-header>
                <change-tree></change-tree>
                <commit-info></commit-info>
              </info-panel>
            </main-content>
            <controls>
              <button id="confirm-button">Push</button>
              <button id="cancel-button">Cancel</button>
            </controls>
            <template id="commit-template">
              <commit>
                <message></message>
              </commit>
            </template>
            <template id="tree-node-template">
              <div>
                <caret></caret>
                <node>  
                  <name></name>
                </node>
              </div>
            </template>
            <template id="commit-info-template">
              <message></message>
              <author></author>
              <date></date>
            </template>
            <script src="${scriptUri}"></script>
          </body>
          </html>`;
}

module.exports = {activate};
