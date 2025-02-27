// Smart Contract (Solidity)
// VotingSystem.sol
pragma solidity ^0.8.0;

contract VotingSystem {
    struct Candidate {
        uint id;
        string name;
        string ipfsHash;
        uint voteCount;
    }
    
    struct Voter {
        bool hasVoted;
        uint votedFor;
        bool isRegistered;
    }
    
    address public admin;
    mapping(address => Voter) public voters;
    mapping(uint => Candidate) public candidates;
    uint public candidatesCount;
    bool public votingOpen;
    string public electionName;
    string public electionIpfsHash;
    
    event VoteCast(address voter, uint candidateId);
    event VoterRegistered(address voter);
    event ElectionStarted(string name);
    event ElectionEnded();
    
    constructor(string memory _name, string memory _ipfsHash) {
        admin = msg.sender;
        electionName = _name;
        electionIpfsHash = _ipfsHash;
        votingOpen = false;
    }
    
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin can perform this action");
        _;
    }
    
    modifier onlyRegistered() {
        require(voters[msg.sender].isRegistered, "Voter not registered");
        _;
    }
    
    function addCandidate(string memory _name, string memory _ipfsHash) public onlyAdmin {
        candidatesCount++;
        candidates[candidatesCount] = Candidate(candidatesCount, _name, _ipfsHash, 0);
    }
    
    function registerVoter(address _voter) public onlyAdmin {
        require(!voters[_voter].isRegistered, "Voter already registered");
        voters[_voter].isRegistered = true;
        emit VoterRegistered(_voter);
    }
    
    function startVoting() public onlyAdmin {
        votingOpen = true;
        emit ElectionStarted(electionName);
    }
    
    function vote(uint _candidateId) public onlyRegistered {
        require(votingOpen, "Voting is not open");
        require(!voters[msg.sender].hasVoted, "Already voted");
        require(_candidateId > 0 && _candidateId <= candidatesCount, "Invalid candidate");
        
        voters[msg.sender].hasVoted = true;
        voters[msg.sender].votedFor = _candidateId;
        candidates[_candidateId].voteCount++;
        
        emit VoteCast(msg.sender, _candidateId);
    }
    
    function endVoting() public onlyAdmin {
        votingOpen = false;
        emit ElectionEnded();
    }
}

// Frontend React Application
// App.js
import React, { useState, useEffect } from 'react';
import Web3 from 'web3';
import IPFS from 'ipfs-http-client';
import VotingSystem from './contracts/VotingSystem.json';

const App = () => {
  const [web3, setWeb3] = useState(null);
  const [contract, setContract] = useState(null);
  const [account, setAccount] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isRegistered, setIsRegistered] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    initializeWeb3();
  }, []);

  const initializeWeb3 = async () => {
    try {
      if (window.ethereum) {
        const web3Instance = new Web3(window.ethereum);
        await window.ethereum.enable();
        setWeb3(web3Instance);
        
        const accounts = await web3Instance.eth.getAccounts();
        setAccount(accounts[0]);
        
        const networkId = await web3Instance.eth.net.getId();
        const deployedNetwork = VotingSystem.networks[networkId];
        
        const contractInstance = new web3Instance.eth.Contract(
          VotingSystem.abi,
          deployedNetwork.address
        );
        
        setContract(contractInstance);
        await loadBlockchainData(contractInstance, accounts[0]);
        
        // Subscribe to account changes
        window.ethereum.on('accountsChanged', (accounts) => {
          setAccount(accounts[0]);
        });
        
      } else {
        setError('Please install MetaMask to use this application');
      }
    } catch (error) {
      setError('Failed to load web3, accounts, or contract');
      console.error(error);
    }
    setLoading(false);
  };

  const loadBlockchainData = async (contractInstance, account) => {
    try {
      const admin = await contractInstance.methods.admin().call();
      setIsAdmin(admin.toLowerCase() === account.toLowerCase());
      
      const voter = await contractInstance.methods.voters(account).call();
      setIsRegistered(voter.isRegistered);
      setHasVoted(voter.hasVoted);
      
      await loadCandidates(contractInstance);
    } catch (error) {
      setError('Error loading blockchain data');
      console.error(error);
    }
  };

  const loadCandidates = async (contractInstance) => {
    try {
      const count = await contractInstance.methods.candidatesCount().call();
      const loadedCandidates = [];
      
      for (let i = 1; i <= count; i++) {
        const candidate = await contractInstance.methods.candidates(i).call();
        const ipfsData = await loadIpfsData(candidate.ipfsHash);
        loadedCandidates.push({
          ...candidate,
          details: ipfsData
        });
      }
      
      setCandidates(loadedCandidates);
    } catch (error) {
      setError('Error loading candidates');
      console.error(error);
    }
  };

  const loadIpfsData = async (hash) => {
    try {
      const ipfs = IPFS.create();
      const stream = ipfs.cat(hash);
      let data = '';
      
      for await (const chunk of stream) {
        data += chunk.toString();
      }
      
      return JSON.parse(data);
    } catch (error) {
      console.error('Error loading IPFS data:', error);
      return null;
    }
  };

  const registerVoter = async (voterAddress) => {
    try {
      await contract.methods.registerVoter(voterAddress)
        .send({ from: account });
      setIsRegistered(true);
    } catch (error) {
      setError('Error registering voter');
      console.error(error);
    }
  };

  const addCandidate = async (name, details) => {
    try {
      setLoading(true);
      
      // Upload candidate details to IPFS
      const ipfs = IPFS.create();
      const { path } = await ipfs.add(JSON.stringify(details));
      
      await contract.methods.addCandidate(name, path)
        .send({ from: account });
      
      await loadCandidates(contract);
    } catch (error) {
      setError('Error adding candidate');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const castVote = async (candidateId) => {
    try {
      setLoading(true);
      await contract.methods.vote(candidateId)
        .send({ from: account });
      setHasVoted(true);
      await loadCandidates(contract);
    } catch (error) {
      setError('Error casting vote');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const startVoting = async () => {
    try {
      await contract.methods.startVoting()
        .send({ from: account });
    } catch (error) {
      setError('Error starting voting');
      console.error(error);
    }
  };

  const endVoting = async () => {
    try {
      await contract.methods.endVoting()
        .send({ from: account });
    } catch (error) {
      setError('Error ending voting');
      console.error(error);
    }
  };

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div className="app-container">
      <header>
        <h1>Blockchain Voting System</h1>
        <p>Your Account: {account}</p>
        {isAdmin && <p>Admin Account</p>}
      </header>

      {isAdmin && (
        <div className="admin-panel">
          <h2>Admin Panel</h2>
          <button onClick={startVoting}>Start Voting</button>
          <button onClick={endVoting}>End Voting</button>
          <AddCandidateForm onSubmit={addCandidate} />
          <RegisterVoterForm onSubmit={registerVoter} />
        </div>
      )}

      {isRegistered ? (
        <div className="voting-section">
          <h2>Candidates</h2>
          <div className="candidates-grid">
            {candidates.map(candidate => (
              <CandidateCard
                key={candidate.id}
                candidate={candidate}
                onVote={castVote}
                hasVoted={hasVoted}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="registration-notice">
          <p>You are not registered to vote.</p>
          <p>Please contact the administrator to get registered.</p>
        </div>
      )}

      <VotingResults candidates={candidates} />
    </div>
  );
};

// Component for adding new candidates
const AddCandidateForm = ({ onSubmit }) => {
  const [name, setName] = useState('');
  const [details, setDetails] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(name, { details });
    setName('');
    setDetails('');
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="text"
        placeholder="Candidate Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <textarea
        placeholder="Candidate Details"
        value={details}
        onChange={(e) => setDetails(e.target.value)}
      />
      <button type="submit">Add Candidate</button>
    </form>
  );
};

// Component for registering voters
const RegisterVoterForm = ({ onSubmit }) => {
  const [address, setAddress] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(address);
    setAddress('');
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="text"
        placeholder="Voter Address"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
      />
      <button type="submit">Register Voter</button>
    </form>
  );
};

// Component for displaying candidate information
const CandidateCard = ({ candidate, onVote, hasVoted }) => {
  return (
    <div className="candidate-card">
      <h3>{candidate.name}</h3>
      <p>{candidate.details?.details}</p>
      <p>Votes: {candidate.voteCount}</p>
      {!hasVoted && (
        <button onClick={() => onVote(candidate.id)}>
          Vote for {candidate.name}
        </button>
      )}
    </div>
  );
};

// Component for displaying voting results
const VotingResults = ({ candidates }) => {
  return (
    <div className="voting-results">
      <h2>Current Results</h2>
      <div className="results-chart">
        {candidates.map(candidate => (
          <div key={candidate.id} className="result-bar">
            <div className="bar" style={{
              width: `${(candidate.voteCount / getTotalVotes(candidates)) * 100}%`
            }}>
              {candidate.name}: {candidate.voteCount} votes
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const getTotalVotes = (candidates) => {
  return candidates.reduce((sum, candidate) => sum + parseInt(candidate.voteCount), 0);
};

export default App;