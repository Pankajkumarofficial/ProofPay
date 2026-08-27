import {
  PromiseModel,
  Condition,
  Evidence,
  Payment,
  AuditLog,
  Notification,
  PAYMENT_STATUS,
} from '../models/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * Promise Space in one request. Every number below is produced by an aggregation
 * over this user's records — there is no counter kept anywhere to drift.
 */
export const getDashboard = asyncHandler(async (req, res) => {
  const visibility = PromiseModel.visibilityFilter(req.user);
  const now = new Date();
  const soon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [totals, byStatus, byCurrency, heldValue, releasedValue, conditionTotals, evidenceTotal, atRisk, upcoming, unread, recentChronicle] =
    await Promise.all([
      PromiseModel.aggregate([
        { $match: visibility },
        {
          $group: {
            _id: null,
            totalPromises: { $sum: 1 },
            totalValue: { $sum: '$amount' },
            averageProofConfidence: { $avg: '$proofConfidence' },
            averagePromiseHealth: { $avg: '$promiseHealth.overall' },
          },
        },
      ]),
      PromiseModel.aggregate([
        { $match: visibility },
        { $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: '$amount' } } },
        { $sort: { count: -1 } },
      ]),
      PromiseModel.aggregate([
        { $match: visibility },
        { $group: { _id: '$currency', count: { $sum: 1 }, value: { $sum: '$amount' } } },
        { $sort: { count: -1 } },
      ]),
      Payment.aggregate([
        { $match: { $or: [{ payer: req.user._id }, { 'recipient.user': req.user._id }], status: { $in: [PAYMENT_STATUS.HELD, PAYMENT_STATUS.FUNDED] } } },
        { $group: { _id: '$currency', value: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      Payment.aggregate([
        { $match: { $or: [{ payer: req.user._id }, { 'recipient.user': req.user._id }], status: PAYMENT_STATUS.RELEASED } },
        { $group: { _id: '$currency', value: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      PromiseModel.aggregate([
        { $match: visibility },
        { $lookup: { from: 'conditions', localField: '_id', foreignField: 'promise', as: 'conditions' } },
        { $unwind: { path: '$conditions', preserveNullAndEmptyArrays: false } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            verified: { $sum: { $cond: [{ $in: ['$conditions.status', ['VERIFIED', 'WAIVED']] }, 1, 0] } },
            awaiting: { $sum: { $cond: [{ $in: ['$conditions.status', ['PENDING', 'AWAITING_PROOF']] }, 1, 0] } },
            contested: { $sum: { $cond: [{ $in: ['$conditions.status', ['CONTESTED', 'FAILED']] }, 1, 0] } },
          },
        },
      ]),
      PromiseModel.aggregate([
        { $match: visibility },
        { $lookup: { from: 'evidences', localField: '_id', foreignField: 'promise', as: 'proof' } },
        { $project: { count: { $size: '$proof' } } },
        { $group: { _id: null, total: { $sum: '$count' } } },
      ]),
      // At risk: health is poor, or the deadline is inside a week and unproven.
      // Both clauses are $or, so they go under $and — spreading `visibility`
      // beside a second $or would silently drop it and count everyone's promises.
      PromiseModel.countDocuments({
        status: { $nin: ['FULFILLED', 'CANCELLED'] },
        $and: [
          visibility,
          {
            $or: [
              { 'promiseHealth.overall': { $lt: 45 } },
              { deadline: { $gte: now, $lte: soon }, proofConfidence: { $lt: 80 } },
              { deadline: { $lt: now } },
            ],
          },
        ],
      }),
      PromiseModel.find({
        ...visibility,
        status: { $nin: ['FULFILLED', 'CANCELLED'] },
        deadline: { $ne: null },
      })
        .sort({ deadline: 1 })
        .limit(5)
        .select('title publicId amount currency deadline status proofConfidence promiseHealth')
        .lean(),
      Notification.countDocuments({ user: req.user._id, read: false }),
      AuditLog.find({ user: req.user._id })
        .sort({ createdAt: -1 })
        .limit(8)
        .populate('promise', 'title publicId')
        .lean(),
    ]);

  const statusValue = (statuses) =>
    byStatus.filter((row) => statuses.includes(row._id)).reduce((sum, row) => sum + row.value, 0);
  const statusCount = (statuses) =>
    byStatus.filter((row) => statuses.includes(row._id)).reduce((sum, row) => sum + row.count, 0);

  const summary = totals[0] ?? {
    totalPromises: 0,
    totalValue: 0,
    averageProofConfidence: 0,
    averagePromiseHealth: 0,
  };

  res.json({
    success: true,
    data: {
      // The currency the user actually works in, not a constant in the UI.
      primaryCurrency: byCurrency[0]?._id ?? 'INR',
      totals: {
        totalPromises: summary.totalPromises,
        activePromises: statusCount(['FUNDED', 'ACTIVE', 'PARTIALLY_VERIFIED', 'READY_TO_FULFILL']),
        readyPromises: statusCount(['READY_TO_FULFILL']),
        fulfilledPromises: statusCount(['FULFILLED']),
        contestedPromises: statusCount(['CONTESTED']),
        pendingPromises: statusCount(['DRAFT']),
        expiredPromises: statusCount(['EXPIRED']),
        cancelledPromises: statusCount(['CANCELLED']),
        atRiskPromises: atRisk,
        totalValue: summary.totalValue,
        conditionalValue: statusValue(['FUNDED', 'ACTIVE', 'PARTIALLY_VERIFIED', 'READY_TO_FULFILL']),
        readyValue: statusValue(['READY_TO_FULFILL']),
        fulfilledValue: statusValue(['FULFILLED']),
        heldValue: heldValue.reduce((sum, row) => sum + row.value, 0),
        releasedValue: releasedValue.reduce((sum, row) => sum + row.value, 0),
        averageProofConfidence: Math.round(summary.averageProofConfidence ?? 0),
        averagePromiseHealth: Math.round(summary.averagePromiseHealth ?? 0),
        totalConditions: conditionTotals[0]?.total ?? 0,
        verifiedConditions: conditionTotals[0]?.verified ?? 0,
        awaitingConditions: conditionTotals[0]?.awaiting ?? 0,
        contestedConditions: conditionTotals[0]?.contested ?? 0,
        totalEvidence: evidenceTotal[0]?.total ?? 0,
        unreadNotifications: unread,
      },
      statusBreakdown: byStatus.map((row) => ({ status: row._id, count: row.count, value: row.value })),
      currencyBreakdown: byCurrency.map((row) => ({ currency: row._id, count: row.count, value: row.value })),
      upcomingDeadlines: upcoming,
      recentChronicle,
    },
  });
});

/** The Promise Space canvas: one node per promise, with its live vitals. */
export const getPromiseSpace = asyncHandler(async (req, res) => {
  const promises = await PromiseModel.find({
    ...PromiseModel.visibilityFilter(req.user),
  })
    .sort({ createdAt: -1 })
    .limit(120)
    .lean();

  const ids = promises.map((promise) => promise._id);
  const [conditionRows, evidenceRows] = await Promise.all([
    Condition.aggregate([
      { $match: { promise: { $in: ids } } },
      {
        $group: {
          _id: '$promise',
          total: { $sum: 1 },
          verified: { $sum: { $cond: [{ $in: ['$status', ['VERIFIED', 'WAIVED']] }, 1, 0] } },
        },
      },
    ]),
    Evidence.aggregate([
      { $match: { promise: { $in: ids } } },
      { $group: { _id: '$promise', total: { $sum: 1 } } },
    ]),
  ]);

  const conditionMap = new Map(conditionRows.map((row) => [String(row._id), row]));
  const evidenceMap = new Map(evidenceRows.map((row) => [String(row._id), row.total]));

  res.json({
    success: true,
    data: {
      nodes: promises.map((promise) => ({
        id: String(promise._id),
        publicId: promise.publicId,
        title: promise.title,
        amount: promise.amount,
        currency: promise.currency,
        status: promise.status,
        deadline: promise.deadline,
        proofConfidence: promise.proofConfidence,
        health: promise.promiseHealth?.overall ?? 0,
        recipient: promise.recipient?.name,
        relation: String(promise.payer) === String(req.user._id) ? 'payer' : 'recipient',
        conditions: conditionMap.get(String(promise._id))?.total ?? 0,
        verifiedConditions: conditionMap.get(String(promise._id))?.verified ?? 0,
        evidenceCount: evidenceMap.get(String(promise._id)) ?? 0,
        createdAt: promise.createdAt,
      })),
    },
  });
});
