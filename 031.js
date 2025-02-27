class IdentityManager {
  constructor() {
    this.web3 = new Web3(Web3.givenProvider);
    this.contract = new this.web3.eth.Contract(ABI, CONTRACT_ADDRESS);
    this.did = null;
    this.credentials = new Map();
    
    this.init();
  }

  async init() {
    await this.connectWallet();
    await this.initializeDID();
    this.setupEventListeners();
  }

  async connectWallet() {
    const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
    this.address = accounts[0];
  }

  async initializeDID() {
    if (!this.did) {
      this.did = `did:ethr:${this.address}`;
      await this.registerDID();
    }
  }

  async registerDID() {
    const didDocument = {
      '@context': 'https://www.w3.org/ns/did/v1',
      id: this.did,
      controller: this.address,
      authentication: [{
        id: `${this.did}#keys-1`,
        type: 'EcdsaSecp256k1RecoveryMethod2020',
        controller: this.did,
        blockchainAccountId: this.address
      }],
      service: []
    };

    await this.contract.methods.registerDID(
      this.did,
      JSON.stringify(didDocument)
    ).send({ from: this.address });
  }

  setupEventListeners() {
    document.getElementById('create-credential').addEventListener('submit', (e) => {
      e.preventDefault();
      this.createVerifiableCredential(new FormData(e.target));
    });

    document.getElementById('verify-credential').addEventListener('submit', (e) => {
      e.preventDefault();
      this.verifyCredential(e.target.credentialId.value);
    });
  }

  async createVerifiableCredential(formData) {
    const credential = {
      '@context': [
        'https://www.w3.org/2018/credentials/v1',
        'https://www.w3.org/2018/credentials/examples/v1'
      ],
      id: `urn:uuid:${crypto.randomUUID()}`,
      type: ['VerifiableCredential', formData.get('type')],
      issuer: this.did,
      issuanceDate: new Date().toISOString(),
      credentialSubject: {
        id: formData.get('subjectDid'),
        claims: JSON.parse(formData.get('claims'))
      }
    };

    const signature = await this.signCredential(credential);
    credential.proof = {
      type: 'EcdsaSecp256k1RecoverySignature2020',
      created: new Date().toISOString(),
      verificationMethod: `${this.did}#keys-1`,
      proofPurpose: 'assertionMethod',
      jws: signature
    };

    await this.storeCredential(credential);
    return credential;
  }

  async signCredential(credential) {
    const message = this.web3.utils.keccak256(
      JSON.stringify(credential)
    );
    
    const signature = await this.web3.eth.personal.sign(
      message,
      this.address,
      ''
    );

    return signature;
  }

  async storeCredential(credential) {
    const ipfsResult = await this.uploadToIPFS(credential);
    
    await this.contract.methods.addCredential(
      credential.id,
      ipfsResult.path,
      credential.credentialSubject.id
    ).send({ from: this.address });

    this.credentials.set(credential.id, credential);
    this.updateCredentialsList();
  }

  async verifyCredential(credentialId) {
    const credential = await this.getCredential(credentialId);
    if (!credential) {
      throw new Error('Credential not found');
    }

    const message = this.web3.utils.keccak256(
      JSON.stringify({
        ...credential,
        proof: undefined
      })
    );

    const recoveredAddress = this.web3.eth.accounts.recover(
      message,
      credential.proof.jws
    );

    const isValid = recoveredAddress.toLowerCase() === 
                    credential.issuer.split(':')[2].toLowerCase();

    return {
      isValid,
      issuer: credential.issuer,
      subject: credential.credentialSubject.id,
      claims: credential.credentialSubject.claims
    };
  }

  async getCredential(credentialId) {
    const ipfsHash = await this.contract.methods.getCredentialIPFS(credentialId)
      .call();
    
    if (!ipfsHash) return null;

    const credential = await this.fetchFromIPFS(ipfsHash);
    return credential;
  }

  updateCredentialsList() {
    const container = document.getElementById('credentials-list');
    container.innerHTML = Array.from(this.credentials.values())
      .map(cred => `
        <div class="credential-item">
          <h3>${cred.type[1]}</h3>
          <p>ID: ${cred.id}</p>
          <p>Subject: ${cred.credentialSubject.id}</p>
          <button onclick="identity.verifyCredential('${cred.id}')">
            Verify
          </button>
        </div>
      `).join('');
  }

  async uploadToIPFS(data) {
    const ipfs = IpfsHttpClient('https://ipfs.infura.io:5001');
    return await ipfs.add(JSON.stringify(data));
  }

  async fetchFromIPFS(hash) {
    const ipfs = IpfsHttpClient('https://ipfs.infura.io:5001');
    const stream = ipfs.cat(hash);
    let data = '';
    
    for await (const chunk of stream) {
      data += chunk.toString();
    }
    
    return JSON.parse(data);
  }
}

// Smart Contract
const contractCode = `
pragma solidity ^0.8.0;

contract IdentityManagement {
    struct DIDDocument {
        string did;
        string document;
        bool active;
    }

    struct Credential {
        string ipfsHash;
        address issuer;
        string subject;
        bool revoked;
    }

    mapping(string => DIDDocument) public dids;
    mapping(string => Credential) public credentials;
    mapping(address => string[]) public userCredentials;

    event DIDRegistered(string did, address controller);
    event CredentialIssued(string credentialId, string subject);
    event CredentialRevoked(string credentialId);

    function registerDID(string memory _did, string memory _document) public {
        require(dids[_did].active == false, "DID already registered");
        
        dids[_did] = DIDDocument({
            did: _did,
            document: _document,
            active: true
        });

        emit DIDRegistered(_did, msg.sender);
    }

    function addCredential(
        string memory _credentialId,
        string memory _ipfsHash,
        string memory _subject
    ) public {
        require(credentials[_credentialId].issuer == address(0), "Credential ID exists");
        
        credentials[_credentialId] = Credential({
            ipfsHash: _ipfsHash,
            issuer: msg.sender,
            subject: _subject,
            revoked: false
        });

        userCredentials[msg.sender].push(_credentialId);
        emit CredentialIssued(_credentialId, _subject);
    }

    function revokeCredential(string memory _credentialId) public {
        require(credentials[_credentialId].issuer == msg.sender, "Not issuer");
        credentials[_credentialId].revoked = true;
        emit CredentialRevoked(_credentialId);
    }

    function getCredentialIPFS(string memory _credentialId) 
        public view returns (string memory) {
        require(!credentials[_credentialId].revoked, "Credential revoked");
        return credentials[_credentialId].ipfsHash;
    }

    function getUserCredentials(address _user) 
        public view returns (string[] memory) {
        return userCredentials[_user];
    }
}
`;

// Initialize identity manager
const identity = new IdentityManager();