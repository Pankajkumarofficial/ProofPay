import { http } from './http.js';

export const promiseApi = {
  list: (params = {}) => http.get('/promises', { params }),
  get: (id) => http.get(`/promises/${id}`),
  create: (payload) => http.post('/promises', payload),
  update: (id, payload) => http.patch(`/promises/${id}`, payload),
  cancel: (id) => http.delete(`/promises/${id}`),

  fund: (id, providerPayload = {}) => http.post(`/promises/${id}/fund`, { providerPayload }),
  verifyFunding: (id, providerPayload) => http.post(`/promises/${id}/fund/verify`, { providerPayload }),
  fulfil: (id, note = '') => http.post(`/promises/${id}/fulfill`, { confirm: true, note }),
  recalculate: (id) => http.post(`/promises/${id}/recalculate`),

  /** Details go straight through to the provider; only tokens come back. */
  setPayoutDestination: (id, destination) => http.post(`/promises/${id}/payout-destination`, destination),
  refreshPayout: (id) => http.post(`/promises/${id}/payout/refresh`),

  chronicle: (id) => http.get(`/promises/${id}/chronicle`),
  briefing: (id) => http.get(`/promises/${id}/briefing`),
  search: (q) => http.get('/promises/search', { params: { q } }),

  listConditions: (id) => http.get(`/promises/${id}/conditions`),
  addCondition: (id, payload) => http.post(`/promises/${id}/conditions`, payload),
  updateCondition: (conditionId, payload) => http.patch(`/conditions/${conditionId}`, payload),
  removeCondition: (conditionId) => http.delete(`/conditions/${conditionId}`),
  confirmCondition: (conditionId, approve, note = '') =>
    http.post(`/conditions/${conditionId}/confirm`, { approve, note }),

  space: () => http.get('/promise-space'),
  dashboard: () => http.get('/dashboard'),
  seedScenario: () => http.post('/demo/scenario'),
};
