import {
  PromiseModel,
  Condition,
  Evidence,
  Payment,
  PAYMENT_STATUS,
  CLOSED_PROMISE_STATUS,
} from '../models/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/** Every chart in the product reads from here. */
export const getAnalytics = asyncHandler(async (req, res) => {
  const { months } = req.validatedQuery;
  const visibility = PromiseModel.visibilityFilter(req.user);

  const since = new Date();
  since.setMonth(since.getMonth() - (months - 1));
  since.setDate(1);
  since.setHours(0, 0, 0, 0);

  const [monthlyCreated, monthlyFulfilled, statusMix, conditionMix, evidenceMix, healthBands, topCounterparties, settlement] =
    await Promise.all([
      PromiseModel.aggregate([
        { $match: { ...visibility, createdAt: { $gte: since } } },
        {
          $group: {
            _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
            count: { $sum: 1 },
            value: { $sum: '$amount' },
          },
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
      ]),
      PromiseModel.aggregate([
        { $match: { ...visibility, fulfilledAt: { $gte: since, $ne: null } } },
        {
          $group: {
            _id: { year: { $year: '$fulfilledAt' }, month: { $month: '$fulfilledAt' } },
            count: { $sum: 1 },
            value: { $sum: '$amount' },
          },
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
      ]),
      PromiseModel.aggregate([
        { $match: visibility },
        { $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: '$amount' } } },
        { $sort: { count: -1 } },
      ]),
      PromiseModel.aggregate([
        { $match: visibility },
        { $lookup: { from: 'conditions', localField: '_id', foreignField: 'promise', as: 'condition' } },
        { $unwind: '$condition' },
        { $group: { _id: '$condition.status', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      PromiseModel.aggregate([
        { $match: visibility },
        { $lookup: { from: 'evidences', localField: '_id', foreignField: 'promise', as: 'proof' } },
        { $unwind: '$proof' },
        { $group: { _id: '$proof.type', count: { $sum: 1 }, avgConfidence: { $avg: '$proof.confidence' } } },
        { $sort: { count: -1 } },
      ]),
      PromiseModel.aggregate([
        { $match: { ...visibility, status: { $nin: CLOSED_PROMISE_STATUS } } },
        {
          $bucket: {
            groupBy: '$promiseHealth.overall',
            boundaries: [0, 25, 50, 75, 101],
            default: 'unknown',
            output: { count: { $sum: 1 }, value: { $sum: '$amount' } },
          },
        },
      ]),
      PromiseModel.aggregate([
        { $match: visibility },
        {
          $group: {
            _id: '$recipient.name',
            count: { $sum: 1 },
            value: { $sum: '$amount' },
            fulfilled: { $sum: { $cond: [{ $eq: ['$status', 'FULFILLED'] }, 1, 0] } },
            avgConfidence: { $avg: '$proofConfidence' },
          },
        },
        { $sort: { value: -1 } },
        { $limit: 6 },
      ]),
      PromiseModel.aggregate([
        { $match: { ...visibility, fulfilledAt: { $ne: null } } },
        {
          $project: {
            days: {
              $divide: [{ $subtract: ['$fulfilledAt', '$createdAt'] }, 1000 * 60 * 60 * 24],
            },
            amount: 1,
          },
        },
        { $group: { _id: null, averageDays: { $avg: '$days' }, fastest: { $min: '$days' }, count: { $sum: 1 } } },
      ]),
    ]);

  // Build a dense month axis so a quiet month renders as zero, not as a gap.
  const axis = [];
  const cursor = new Date(since);
  for (let index = 0; index < months; index += 1) {
    axis.push({ year: cursor.getFullYear(), month: cursor.getMonth() + 1 });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  const keyOf = (row) => `${row._id.year}-${row._id.month}`;
  const createdMap = new Map(monthlyCreated.map((row) => [keyOf(row), row]));
  const fulfilledMap = new Map(monthlyFulfilled.map((row) => [keyOf(row), row]));
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const timeline = axis.map(({ year, month }) => {
    const key = `${year}-${month}`;
    return {
      label: `${monthNames[month - 1]} ${String(year).slice(2)}`,
      year,
      month,
      created: createdMap.get(key)?.count ?? 0,
      createdValue: createdMap.get(key)?.value ?? 0,
      fulfilled: fulfilledMap.get(key)?.count ?? 0,
      fulfilledValue: fulfilledMap.get(key)?.value ?? 0,
    };
  });

  const bandLabels = { 0: 'Critical', 25: 'At risk', 50: 'Steady', 75: 'Healthy' };

  res.json({
    success: true,
    data: {
      months,
      timeline,
      statusMix: statusMix.map((row) => ({ status: row._id, count: row.count, value: row.value })),
      conditionMix: conditionMix.map((row) => ({ status: row._id, count: row.count })),
      evidenceMix: evidenceMix.map((row) => ({
        type: row._id,
        count: row.count,
        averageConfidence: Math.round(row.avgConfidence ?? 0),
      })),
      healthBands: healthBands.map((row) => ({
        band: bandLabels[row._id] ?? String(row._id),
        floor: typeof row._id === 'number' ? row._id : null,
        count: row.count,
        value: row.value,
      })),
      counterparties: topCounterparties.map((row) => ({
        name: row._id ?? 'Unnamed',
        count: row.count,
        value: row.value,
        fulfilled: row.fulfilled,
        averageConfidence: Math.round(row.avgConfidence ?? 0),
      })),
      settlement: settlement[0]
        ? {
            averageDays: Math.max(0, Math.round((settlement[0].averageDays ?? 0) * 10) / 10),
            fastestDays: Math.max(0, Math.round((settlement[0].fastest ?? 0) * 10) / 10),
            count: settlement[0].count,
          }
        : { averageDays: 0, fastestDays: 0, count: 0 },
    },
  });
});
