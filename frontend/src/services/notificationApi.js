import { http } from './http.js';

export const notificationApi = {
  list: (params = {}) => http.get('/notifications', { params }),
  markRead: (id) => http.patch(`/notifications/${id}/read`),
  markAllRead: () => http.patch('/notifications/read-all'),
};
