import { http } from './http.js';

export const analyticsApi = {
  get: (months = 6) => http.get('/analytics', { params: { months } }),
  chronicle: (params = {}) => http.get('/chronicle', { params }),
};
