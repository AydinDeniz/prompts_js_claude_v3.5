class LegalDocumentAnalyzer {
  constructor() {
    this.nlpModel = null;
    this.documents = new Map();
    this.termDatabase = new Map();
    this.clausePatterns = new Map();
    this.summaries = new Map();
    
    this.init();
  }

  async init() {
    await this.loadModels();
    this.setupDatabase();
    this.initializeUI();
    await this.loadLegalTerminology();
    this.setupEventListeners();
  }

  async loadModels() {
    try {
      // Load NLP model for text analysis
      this.nlpModel = await use.load();
      
      // Load specialized legal term classifier
      this.termClassifier = await tf.loadLayersModel('/models/legal/term-classifier.json');
      
      // Load document summarization model
      this.summaryModel = await tf.loadLayersModel('/models/legal/summarizer.json');
    } catch (error) {
      console.error('Failed to load NLP models:', error);
    }
  }

  setupDatabase() {
    this.db = new PouchDB('legal_analyzer');
    
    // Sync with remote database if available
    PouchDB.sync('legal_analyzer', 'http://localhost:5984/legal_analyzer', {
      live: true,
      retry: true
    });
  }

  initializeUI() {
    this.elements = {
      documentUpload: document.getElementById('document-upload'),
      analysisPanel: document.getElementById('analysis-panel'),
      termsList: document.getElementById('terms-list'),
      clausePanel: document.getElementById('clause-panel'),
      summaryPanel: document.getElementById('summary-panel'),
      exportButton: document.getElementById('export-analysis')
    };

    this.setupTextEditor();
  }

  setupTextEditor() {
    this.editor = CodeMirror(document.getElementById('document-editor'), {
      mode: 'markdown',
      theme: 'legal',
      lineNumbers: true,
      lineWrapping: true,
      readOnly: false
    });

    this.editor.on('change', () => {
      this.analyzeDocumentChanges();
    });
  }

  async loadLegalTerminology() {
    try {
      const response = await fetch('/api/legal-terms');
      const terms = await response.json();
      
      terms.forEach(term => {
        this.termDatabase.set(term.name, {
          definition: term.definition,
          category: term.category,
          importance: term.importance,
          relatedTerms: term.related
        });
      });
    } catch (error) {
      console.error('Failed to load legal terminology:', error);
    }
  }

  setupEventListeners() {
    this.elements.documentUpload.addEventListener('change', (e) => {
      this.handleFileUpload(e.target.files[0]);
    });

    this.elements.exportButton.addEventListener('click', () => {
      this.exportAnalysis();
    });
  }

  async handleFileUpload(file) {
    try {
      const text = await this.readFile(file);
      const document = {
        id: Date.now().toString(),
        name: file.name,
        content: text,
        type: this.detectDocumentType(text),
        timestamp: new Date()
      };

      this.documents.set(document.id, document);
      this.editor.setValue(text);
      await this.analyzeDocument(document);
    } catch (error) {
      console.error('File upload failed:', error);
    }
  }

  readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (e) => reject(e);
      reader.readAsText(file);
    });
  }

  detectDocumentType(text) {
    const patterns = {
      contract: /agreement|between|parties|terms|conditions/i,
      policy: /policy|guidelines|procedures/i,
      legislation: /act|statute|regulation|law/i,
      court: /court|judgment|ruling|case/i
    };

    for (const [type, pattern] of Object.entries(patterns)) {
      if (pattern.test(text)) return type;
    }

    return 'other';
  }

  async analyzeDocument(document) {
    const analysis = {
      terms: await this.extractLegalTerms(document.content),
      clauses: await this.identifyClauses(document.content),
      summary: await this.generateSummary(document.content),
      entities: await this.extractEntities(document.content),
      risks: await this.assessRisks(document.content),
      metadata: this.extractMetadata(document)
    };

    await this.saveAnalysis(document.id, analysis);
    this.updateUI(analysis);
  }

  async extractLegalTerms(text) {
    const sentences = this.splitIntoSentences(text);
    const terms = new Map();

    for (const sentence of sentences) {
      const embeddings = await this.nlpModel.embed(sentence);
      const prediction = await this.termClassifier.predict(embeddings).data();
      
      if (prediction[0] > 0.7) {
        const extractedTerms = this.findTermsInSentence(sentence);
        extractedTerms.forEach(term => {
          if (this.termDatabase.has(term)) {
            terms.set(term, {
              ...this.termDatabase.get(term),
              context: sentence
            });
          }
        });
      }
    }

    return terms;
  }

  findTermsInSentence(sentence) {
    const terms = [];
    this.termDatabase.forEach((value, term) => {
      if (sentence.toLowerCase().includes(term.toLowerCase())) {
        terms.push(term);
      }
    });
    return terms;
  }

  async identifyClauses(text) {
    const clauses = new Map();
    const sections = this.splitIntoSections(text);

    for (const section of sections) {
      const type = await this.classifyClauseType(section);
      if (type) {
        clauses.set(type, {
          content: section,
          importance: this.assessClauseImportance(type, section),
          relatedTerms: Array.from(await this.extractLegalTerms(section).keys())
        });
      }
    }

    return clauses;
  }

  async classifyClauseType(text) {
    const embedding = await this.nlpModel.embed(text);
    const prediction = await this.termClassifier.predict(embedding).data();
    
    const clauseTypes = [
      'liability', 'termination', 'payment', 'confidentiality',
      'intellectual_property', 'dispute_resolution', 'force_majeure'
    ];

    const typeIndex = prediction.indexOf(Math.max(...prediction));
    return clauseTypes[typeIndex];
  }

  assessClauseImportance(type, content) {
    const importanceFactors = {
      liability: 5,
      termination: 4,
      payment: 4,
      confidentiality: 3,
      intellectual_property: 4,
      dispute_resolution: 3,
      force_majeure: 2
    };

    const baseImportance = importanceFactors[type] || 1;
    const length = content.length;
    const hasDefinedTerms = this.countDefinedTerms(content);
    
    return Math.min(5, baseImportance + 
      (length > 500 ? 1 : 0) + 
      (hasDefinedTerms > 5 ? 1 : 0));
  }

  async generateSummary(text) {
    const sections = this.splitIntoSections(text);
    const summaries = await Promise.all(
      sections.map(section => this.summarizeSection(section))
    );

    return {
      overall: this.combineAndCondenseSummaries(summaries),
      sections: summaries
    };
  }

  async summarizeSection(text) {
    const embedding = await this.nlpModel.embed(text);
    const summary = await this.summaryModel.predict(embedding).data();
    return this.decodeSummary(summary);
  }

  async extractEntities(text) {
    const entities = {
      parties: this.extractParties(text),
      dates: this.extractDates(text),
      amounts: this.extractAmounts(text),
      locations: this.extractLocations(text)
    };

    return entities;
  }

  async assessRisks(text) {
    const risks = [];
    const riskPatterns = {
      unlimited_liability: /unlimited liability|full responsibility/i,
      unilateral_termination: /may terminate at any time|sole discretion/i,
      broad_indemnification: /shall indemnify.*against all/i,
      unclear_jurisdiction: /any court of competent jurisdiction/i
    };

    for (const [type, pattern] of Object.entries(riskPatterns)) {
      if (pattern.test(text)) {
        risks.push({
          type,
          severity: this.assessRiskSeverity(type),
          context: this.extractContext(text, pattern)
        });
      }
    }

    return risks;
  }

  assessRiskSeverity(riskType) {
    const severityMap = {
      unlimited_liability: 'high',
      unilateral_termination: 'medium',
      broad_indemnification: 'high',
      unclear_jurisdiction: 'medium'
    };

    return severityMap[riskType] || 'low';
  }

  updateUI(analysis) {
    this.updateTermsList(analysis.terms);
    this.updateClausePanel(analysis.clauses);
    this.updateSummaryPanel(analysis.summary);
    this.highlightRisks(analysis.risks);
  }

  updateTermsList(terms) {
    this.elements.termsList.innerHTML = Array.from(terms.entries())
      .map(([term, details]) => `
        <div class="term-item" data-importance="${details.importance}">
          <h4>${term}</h4>
          <p class="definition">${details.definition}</p>
          <p class="context">${details.context}</p>
          <div class="related-terms">
            ${details.relatedTerms.map(related => `
              <span class="related-term">${related}</span>
            `).join('')}
          </div>
        </div>
      `).join('');
  }

  updateClausePanel(clauses) {
    this.elements.clausePanel.innerHTML = Array.from(clauses.entries())
      .map(([type, clause]) => `
        <div class="clause-item importance-${clause.importance}">
          <h3>${this.formatClauseType(type)}</h3>
          <div class="clause-content">${clause.content}</div>
          <div class="clause-metadata">
            <span class="importance">Importance: ${clause.importance}/5</span>
            <span class="terms">Related Terms: ${
              clause.relatedTerms.join(', ')
            }</span>
          </div>
        </div>
      `).join('');
  }

  updateSummaryPanel(summary) {
    this.elements.summaryPanel.innerHTML = `
      <div class="summary-section">
        <h3>Executive Summary</h3>
        <p>${summary.overall}</p>
      </div>
      <div class="section-summaries">
        ${summary.sections.map(section => `
          <div class="section-summary">
            <p>${section}</p>
          </div>
        `).join('')}
      </div>
    `;
  }

  highlightRisks(risks) {
    const content = this.editor.getValue();
    risks.forEach(risk => {
      const marker = this.editor.markText(
        this.editor.posFromIndex(risk.context.index),
        this.editor.posFromIndex(risk.context.index + risk.context.length),
        {
          className: `risk-highlight severity-${risk.severity}`,
          title: `Risk: ${this.formatRiskType(risk.type)}`
        }
      );
    });
  }

  async exportAnalysis() {
    const document = this.documents.get(this.currentDocumentId);
    const analysis = await this.db.get(`analysis:${document.id}`);

    const exportData = {
      document: {
        name: document.name,
        type: document.type,
        timestamp: document.timestamp
      },
      analysis: {
        summary: analysis.summary,
        terms: Array.from(analysis.terms.entries()),
        clauses: Array.from(analysis.clauses.entries()),
        risks: analysis.risks
      }
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json'
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `analysis-${document.name}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

// Initialize analyzer
const legalAnalyzer = new LegalDocumentAnalyzer();