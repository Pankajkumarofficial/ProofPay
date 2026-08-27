import { http } from './http.js';

export const proofEngineApi = {
  status: () => http.get('/ai/status'),
  parsePromise: (text, currency = 'INR') => http.post('/ai/parse-promise', { text, currency }),
  detectAmbiguity: (text, conditions = []) => http.post('/ai/detect-ambiguity', { text, conditions }),
  analyzeEvidence: (evidenceId, conditionId) =>
    http.post('/ai/analyze-evidence', { evidenceId, conditionId }),
  analyzeDispute: (disputeId) => http.post('/ai/analyze-dispute', { disputeId }),
};
