(async function() {
  const vscode = acquireVsCodeApi();
  
  const {currentWorkspaceName} = await postMessage('getCurrentWorkspaceName');
  const {currentRemoteName} = await postMessage('getCurrentRemoteName');
  const {currentBranchName} = await postMessage('getCurrentBranchName');
  const {unpushedCommits} = await postMessage('getUnpushedCommits');
  
  // This creates the entry at the very top of our commits list which rolls all of
  // the commits up into a single item so the user can see all file changes at once
  const headCommit = {
    message: `${currentBranchName} → ${currentRemoteName} : ${currentBranchName}`,
    files: unpushedCommits.reduce((accumulator, commit) => {
      commit.files.forEach(file => {
        const existingItem = accumulator.find(i => i.path === file.path);
        if (existingItem)
          existingItem.parentHash = file.parentHash;
        else
          accumulator.push(Object.assign({}, file));
      });
      return accumulator;
    }, [])
  };
  
  // Add the headCommit to the rest of our commits at the front of the array
  const commits = [headCommit, ...unpushedCommits];
  
  renderCommits(commits);
  
  // Apply default selection to first commit in the list
  selectCommit(document.querySelector('commit'));
  
  document.querySelector('#confirm-button').onclick = () => {
    vscode.postMessage({message: 'push'});
  };
  
  document.querySelector('#cancel-button').onclick = () => {
    vscode.postMessage({message: 'cancel'});
  };
  
  function onCommitKeydown(e) {
    switch(e.key) {
      case "ArrowUp":
        e.currentTarget.previousSibling && selectCommit(e.currentTarget.previousSibling);
        break;
      case "ArrowDown":
        e.currentTarget.nextSibling && selectCommit(e.currentTarget.nextSibling);
        break;
      default:
        e.preventDefault();
        break;
    }
  }
  
  function selectCommit(targetCommitElement) {
    document.querySelectorAll('commit').forEach(commitElement => {
      if (commitElement === targetCommitElement) {
        commitElement.classList.add('selected');
        commitElement.focus();
        const filePaths = commitElement.commit.files;
        const treeNodes = createTree(currentWorkspaceName, filePaths);
        renderChangeTree(treeNodes);
        renderCommitInfo(commitElement.commit);
      }
      else {
        commitElement.classList.remove('selected');
      }
    });
  }
  
  function createTree(workspaceName, files) {
    const nodes = files.reduce((accumulator, file) => {
      const segments = file.path.split('/');
      let currNode = accumulator[0];
      let prevNode;
      
      segments.forEach((segment, index) => {
        prevNode = currNode;
        currNode = prevNode.items.find(node => node.name === segment);
        if (!currNode) {
          const newNode = {name: segment, type: (segments.length === index+1) ? 'file' : 'folder'};
          if (newNode.type === 'folder')
            newNode.items = [];
          else
            Object.assign(newNode, file);
          prevNode.items.push(newNode);
          currNode = newNode;
        }
      });
      
      return accumulator;
    }, [{name: workspaceName, type: 'folder', items: []}]);
    
    nodes[0].items = condenseTreePaths(nodes[0].items);
    
    return nodes;
  }
  
  function condenseTreePaths(nodes) {
    return nodes.reduce((accumulator, node) => {
      if (node.type === 'folder' && node.items.length === 1) {
        const condensee = node.items[0];
        if (condensee.type === 'folder') {
          condenseTreePaths(node.items);
          node.name = `${node.name}/${condensee.name}`;
          node.items = condensee.items;
        }
      }
      accumulator.push(node);
      return accumulator;
    }, []);
  }
  
  function renderCommits(commits) {
    const commitsContainer = document.querySelector('commits');
    const commitTemplate = document.getElementById('commit-template');
    
    commits.forEach((commit, index) => {
      const commitElement = commitTemplate.content.firstElementChild.cloneNode(true);
      commitElement.tabIndex = index+1;
      commitElement.commit = commit;
      commitElement.querySelector('message').textContent = commit.message;
      commitElement.addEventListener('click', e => {selectCommit(e.currentTarget)});
      commitElement.addEventListener('keydown', onCommitKeydown);
      commitsContainer.appendChild(commitElement);
    });
  }
  
  function renderChangeTree(nodes) {
    const treeContainer = removeAllChildren(document.querySelector('change-tree'));
    const treeNodeTemplate = document.getElementById('tree-node-template');
    renderTreeNodes(nodes, treeContainer, treeNodeTemplate);
  }
  
  function renderTreeNodes(nodes, container, nodeTemplate) {
    nodes.forEach(node => {
      const treeNodeElement = nodeTemplate.content.firstElementChild.cloneNode(true);
      
      if (node.type === 'file') {
        treeNodeElement.querySelector('caret').classList.toggle('hidden');
        treeNodeElement.querySelector('name').classList.add('file', node.status);
        treeNodeElement.addEventListener('click', () => {
          vscode.postMessage({message: 'launchDiff', content: node});
        });
      } else {
        treeNodeElement.classList.toggle('folder');
        treeNodeElement.querySelector('caret').onclick = () => {
          treeNodeElement.querySelector('caret').classList.toggle('inactive');
          treeNodeElement.querySelectorAll('node div').forEach(item => item.classList.toggle('hidden'));
        };
      }
      
      treeNodeElement.querySelector('name').textContent = `${node.name}${node.status ? ` ${node.status}` : ''}`;
      
      if (node.type === 'folder') {
        renderTreeNodes(node.items, treeNodeElement.querySelector('node'), nodeTemplate);
      }
      
      container.appendChild(treeNodeElement);
    });
  }
  
  function renderCommitInfo(commit) {
    const commitInfoContainer = document.querySelector('commit-info');
    
    removeAllChildren(commitInfoContainer);
    
    if (commit.hash) {
      const commitInfoTemplate = document.getElementById('commit-info-template');
      const commitInfoElement = commitInfoTemplate.content.cloneNode(true);
      const commitDate = new Date(commit.date);
      commitInfoElement.querySelector('message').textContent = commit.message;
      commitInfoElement.querySelector('author').textContent = commit.author;
      commitInfoElement.querySelector('date').textContent = `${commitDate.toLocaleDateString()} ${commitDate.toLocaleTimeString()}`;
      commitInfoContainer.appendChild(commitInfoElement);
    } else {
      const emptyCommitInfoElement = document.createElement('div');
      emptyCommitInfoElement.style = 'display: flex; align-items: center; justify-content: center; height: 100%; width: 100%;';
      emptyCommitInfoElement.textContent = 'No commit selected';
      commitInfoContainer.appendChild(emptyCommitInfoElement);
    }
  }
  
  function removeAllChildren(htmlEle) {
    while (htmlEle.firstChild)
      htmlEle.removeChild(htmlEle.firstChild);
    return htmlEle;
  }
  
  function postMessage(message) {
    return new Promise(resolve => {
      vscode.postMessage({message});
      window.addEventListener('message', event => {
        window.removeEventListener('message', this);
        resolve(event.data.content);
      });
    });
  }
}());
