import { AuditLog, PromiseModel } from '../models/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/** The Chronicle across everything this user can see. */
export const listChronicle = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 60, 200);
  const action = req.query.action;

  const visible = await PromiseModel.find(PromiseModel.visibilityFilter(req.user)).select('_id').lean();
  const filter = {
    $or: [{ user: req.user._id }, { promise: { $in: visible.map((row) => row._id) } }],
    ...(action ? { action } : {}),
  };

  const [entries, actionCounts] = await Promise.all([
    AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('user', 'name avatar')
      .populate('promise', 'title publicId amount currency')
      .lean(),
    AuditLog.aggregate([
      { $match: { $or: [{ user: req.user._id }, { promise: { $in: visible.map((row) => row._id) } }] } },
      { $group: { _id: '$action', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
  ]);

  res.json({
    success: true,
    data: {
      entries,
      actionCounts: actionCounts.map((row) => ({ action: row._id, count: row.count })),
    },
  });
});
