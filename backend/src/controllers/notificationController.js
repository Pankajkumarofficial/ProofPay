import { Notification } from '../models/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';

export const listNotifications = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const onlyUnread = req.query.unread === 'true';

  const filter = { user: req.user._id, ...(onlyUnread ? { read: false } : {}) };
  const [notifications, unreadCount] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('promise', 'title publicId amount currency status')
      .lean(),
    Notification.countDocuments({ user: req.user._id, read: false }),
  ]);

  res.json({ success: true, data: { notifications, unreadCount } });
});

export const markRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id },
    { $set: { read: true, readAt: new Date() } },
    { new: true }
  );
  if (!notification) throw ApiError.notFound('That notification no longer exists.');
  const unreadCount = await Notification.countDocuments({ user: req.user._id, read: false });
  res.json({ success: true, data: { notification, unreadCount } });
});

export const markAllRead = asyncHandler(async (req, res) => {
  await Notification.updateMany(
    { user: req.user._id, read: false },
    { $set: { read: true, readAt: new Date() } }
  );
  res.json({ success: true, data: { unreadCount: 0 } });
});
