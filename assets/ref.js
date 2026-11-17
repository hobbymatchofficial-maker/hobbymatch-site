/* Counts visits that arrive from an AI assistant, and nothing else.
   If the page was opened from one of the sites below (or with its
   utm_source), this sends that site's name, e.g. "claude.ai", to
   /api/r. Nothing is sent for any other visit. No cookies, no storage, no
   ids: just the name of the assistant. See /privacy, section 6. */
(function () {
  try {
    var SITES = {
      'chatgpt.com': 'chatgpt.com', 'chat.openai.com': 'chatgpt.com',
      'perplexity.ai': 'perplexity.ai', 'www.perplexity.ai': 'perplexity.ai',
      'gemini.google.com': 'gemini.google.com',
      'claude.ai': 'claude.ai',
      'copilot.microsoft.com': 'copilot.microsoft.com'
    };
    var site = null;
    if (document.referrer) site = SITES[new URL(document.referrer).hostname.toLowerCase()] || null;
    if (!site) {
      var utm = new URLSearchParams(location.search).get('utm_source');
      if (utm) site = SITES[utm.toLowerCase()] || null;
    }
    if (!site || !navigator.sendBeacon) return;
    navigator.sendBeacon('/api/r', new Blob([JSON.stringify({ site: site })], { type: 'application/json' }));
  } catch (e) { /* never get in the way of the page */ }
})();
