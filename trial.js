/* The trial-request form on demo.html.
   Without this script the form still works: it posts to /api/request-trial,
   which redirects back here with ?sent=1 or ?error=…, shown below. With it,
   the form submits in place and also tells the server how long the page was
   open (bots fill forms in milliseconds). */
(function () {
  var form = document.getElementById('trialForm');
  var msg = document.getElementById('trialMsg');
  if (!form || !msg) return;
  var shownAt = Date.now();

  function show(text, ok) {
    msg.textContent = text;
    msg.className = 'msg ' + (ok ? 'ok' : 'err');
    msg.hidden = false;
  }

  var q = new URLSearchParams(location.search);
  if (q.get('sent')) show('Thanks — we will be in touch within two working days.', true);
  else if (q.get('error')) show(q.get('error'), false);

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    form.elements.t.value = String(Date.now() - shownAt);
    var button = form.querySelector('button[type=submit]');
    button.disabled = true;
    var body = new URLSearchParams(new FormData(form)).toString();
    fetch(form.action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: body
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, message: 'Something went wrong — please try again.' }; });
    }).then(function (res) {
      show(res.message, res.ok);
      if (res.ok) form.reset(); else button.disabled = false;
    }).catch(function () {
      show('Could not send — check your connection and try again.', false);
      button.disabled = false;
    });
  });
})();
