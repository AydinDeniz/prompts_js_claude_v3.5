class CloudStorageSystem {
  constructor() {
    this.ipfs = IpfsHttpClient('https://ipfs.infura.io:5001');
    this.web3 = new Web3(Web3.givenProvider);
    this.contract = new this.web3.eth.Contract(ABI, CONTRACT_ADDRESS);
    
    this.init();
  }

  async init() {
    this.setupUI();
    this.setupEventListeners();
    await this.connectWallet();
    await this.loadUserFiles();
  }

  setupUI() {
    this.elements = {
      uploadForm: document.getElementById('upload-form'),
      fileList: document.getElementById('file-list'),
      shareModal: document.getElementById('share-modal'),
      progressBar: document.getElementById('upload-progress')
    };
  }

  setupEventListeners() {
    this.elements.uploadForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleFileUpload(e.target.files[0]);
    });
  }

  async connectWallet() {
    const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
    this.userAddress = accounts[0];
  }

  async handleFileUpload(file) {
    try {
      this.showProgress(0);
      
      const encrypted = await this.encryptFile(file);
      const ipfsHash = await this.uploadToIPFS(encrypted);
      await this.registerOnBlockchain(ipfsHash, file.name);
      
      this.showProgress(100);
      this.updateFileList();
    } catch (error) {
      console.error('Upload failed:', error);
    }
  }

  async encryptFile(file) {
    const key = await window.crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );

    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const buffer = await file.arrayBuffer();
    
    const encrypted = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      buffer
    );

    const exportedKey = await window.crypto.subtle.exportKey('raw', key);
    
    return {
      data: encrypted,
      iv,
      key: exportedKey
    };
  }

  async uploadToIPFS(encryptedData) {
    const file = new File([encryptedData.data], 'encrypted', {
      type: 'application/octet-stream'
    });

    const added = await this.ipfs.add(file, {
      progress: (prog) => this.showProgress(prog)
    });

    return added.path;
  }

  async registerOnBlockchain(ipfsHash, fileName) {
    await this.contract.methods.registerFile(
      ipfsHash,
      fileName,
      Date.now()
    ).send({ from: this.userAddress });
  }

  async shareFile(fileId, recipientAddress) {
    await this.contract.methods.shareFile(
      fileId,
      recipientAddress
    ).send({ from: this.userAddress });
  }

  async revokeAccess(fileId, recipientAddress) {
    await this.contract.methods.revokeAccess(
      fileId,
      recipientAddress
    ).send({ from: this.userAddress });
  }

  async loadUserFiles() {
    const files = await this.contract.methods.getUserFiles()
      .call({ from: this.userAddress });
    
    this.updateFileList(files);
  }

  async downloadFile(fileId) {
    const fileData = await this.contract.methods.getFile(fileId)
      .call({ from: this.userAddress });
    
    const encrypted = await this.ipfs.cat(fileData.ipfsHash);
    const decrypted = await this.decryptFile(encrypted, fileData.keyData);
    
    this.triggerDownload(decrypted, fileData.name);
  }

  async decryptFile(encrypted, keyData) {
    const key = await window.crypto.subtle.importKey(
      'raw',
      keyData,
      'AES-GCM',
      true,
      ['decrypt']
    );

    return await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: encrypted.iv },
      key,
      encrypted.data
    );
  }

  updateFileList(files) {
    this.elements.fileList.innerHTML = files.map(file => `
      <div class="file-item">
        <span>${file.name}</span>
        <div class="actions">
          <button onclick="storage.downloadFile('${file.id}')">Download</button>
          <button onclick="storage.showShareModal('${file.id}')">Share</button>
          <button onclick="storage.deleteFile('${file.id}')">Delete</button>
        </div>
      </div>
    `).join('');
  }

  showProgress(percent) {
    this.elements.progressBar.style.width = `${percent}%`;
  }

  showShareModal(fileId) {
    this.elements.shareModal.innerHTML = `
      <div class="modal-content">
        <h3>Share File</h3>
        <input type="text" id="recipient-address" placeholder="Recipient's address">
        <button onclick="storage.shareFile('${fileId}', document.getElementById('recipient-address').value)">
          Share
        </button>
      </div>
    `;
    this.elements.shareModal.style.display = 'block';
  }

  async deleteFile(fileId) {
    await this.contract.methods.deleteFile(fileId)
      .send({ from: this.userAddress });
    this.loadUserFiles();
  }

  triggerDownload(content, filename) {
    const blob = new Blob([content]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}

// Smart Contract (Solidity)
const contractCode = `
pragma solidity ^0.8.0;

contract CloudStorage {
    struct File {
        string ipfsHash;
        string name;
        uint256 timestamp;
        address owner;
        mapping(address => bool) sharedWith;
    }

    mapping(uint256 => File) public files;
    mapping(address => uint256[]) public userFiles;
    uint256 private fileCount;

    event FileUploaded(uint256 fileId, string ipfsHash, address owner);
    event FileShared(uint256 fileId, address owner, address recipient);
    event FileDeleted(uint256 fileId);

    function registerFile(string memory _ipfsHash, string memory _name, uint256 _timestamp) public {
        fileCount++;
        File storage newFile = files[fileCount];
        newFile.ipfsHash = _ipfsHash;
        newFile.name = _name;
        newFile.timestamp = _timestamp;
        newFile.owner = msg.sender;
        
        userFiles[msg.sender].push(fileCount);
        emit FileUploaded(fileCount, _ipfsHash, msg.sender);
    }

    function shareFile(uint256 _fileId, address _recipient) public {
        require(files[_fileId].owner == msg.sender, "Not file owner");
        files[_fileId].sharedWith[_recipient] = true;
        emit FileShared(_fileId, msg.sender, _recipient);
    }

    function revokeAccess(uint256 _fileId, address _recipient) public {
        require(files[_fileId].owner == msg.sender, "Not file owner");
        files[_fileId].sharedWith[_recipient] = false;
    }

    function deleteFile(uint256 _fileId) public {
        require(files[_fileId].owner == msg.sender, "Not file owner");
        delete files[_fileId];
        emit FileDeleted(_fileId);
    }

    function getUserFiles() public view returns (uint256[] memory) {
        return userFiles[msg.sender];
    }
}
`;

const storage = new CloudStorageSystem();