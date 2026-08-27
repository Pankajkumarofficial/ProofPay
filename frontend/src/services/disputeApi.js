import { http } from './http.js';

export const disputeApi = {
  list: () => http.get('/disputes'),
  get: (id) => http.get(`/disputes/${id}`),
  create: (payload) => http.post('/disputes', payload),
  addClaim: (id, payload) => http.post(`/disputes/${id}/evidence`, payload),
  analyse: (id) => http.post(`/disputes/${id}/analyze`),
  resolve: (id, payload) => http.post(`/disputes/${id}/resolve`, payload),
};
