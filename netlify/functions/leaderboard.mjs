// Netlify Function: global leaderboard for total career profit.
// GET  /api/leaderboard          -> top entries
// POST /api/leaderboard {id, name, profit, jobs} -> saves the player's latest total, returns top entries
// Scores are kept in Netlify Blobs (no extra setup needed on Netlify).
import { getStore } from '@netlify/blobs';
import { handle } from '../lib/leaderboard-core.mjs';

export default async (req) => handle(req, getStore({ name: 'leaderboard', consistency: 'strong' }));

export const config = { path: '/api/leaderboard' };
