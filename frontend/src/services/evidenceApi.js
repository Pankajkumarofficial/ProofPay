import { http } from './http.js';

export const evidenceApi = {
  list: (params = {}) => http.get('/evidence', { params }),
  get: (id) => http.get(`/evidence/${id}`),
  remove: (id) => http.delete(`/evidence/${id}`),
  verify: (id, conditionId) => http.post(`/evidence/${id}/verify`, conditionId ? { conditionId } : {}),

  /** Files and links take the same route; multipart is used only when needed. */
  submit: ({ file, ...fields }) => {
    if (!file) return http.post('/evidence', fields);
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined && value !== null) form.append(key, value);
    }
    form.append('file', file);
    return http.post('/evidence', form, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
};
