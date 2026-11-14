// One-click "leave the list" for SYCSTEM notices (the List-Unsubscribe header points here; nothing in the email body does).
// It records the tester number in the function log. Removing them from the list is done from that log, by hand, for now.
module.exports = (req, res) => {
  const n = String((req.query && req.query.n) || '').replace(/[^0-9]/g, '').slice(0, 6);
  console.log('LEAVE', JSON.stringify({ n, method: req.method, at: new Date().toISOString() }));
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.status(200).send('Removed.');
};
