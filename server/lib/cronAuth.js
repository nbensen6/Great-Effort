// Shared auth check for the scheduled-refresh endpoints
// (players/refresh-all, stats/auto-import, practice/scan).
//
// These endpoints each sweep the Riot API for every rostered player, so an
// attacker who can trigger them in a loop can burn the rate limit and get the
// API key throttled or revoked. Two problems this closes:
//
//   1. A hardcoded 'internal-refresh' bypass string accepted in place of the
//      real secret. Nothing internal ever sent it — it was simply a backdoor,
//      and in practice/scan it also granted req.user = { role: 'admin' }.
//   2. An unset CRON_SECRET. The old checks compared the header directly
//      against process.env.CRON_SECRET, and `undefined !== undefined` is
//      false, so a request with no header authenticated successfully.
function isCronRequest(req) {
  const expected = process.env.CRON_SECRET;
  if (typeof expected !== 'string' || expected.length === 0) return false;

  const provided = req.headers['x-cron-secret'];
  return typeof provided === 'string' && provided === expected;
}

module.exports = { isCronRequest };
