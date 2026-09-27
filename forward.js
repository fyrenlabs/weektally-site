/* The app lived on weektally.com until the domains split (2026-09-28), so
   bookmarks like weektally.com/#/week are still out there. The #/… part is
   never sent to the server, so no server-side redirect can see it: forward
   it here, first thing, before the page paints. Anything else in the hash
   (an in-page anchor such as #features) is left alone. Also on hashchange,
   because a #/… link followed from a page already open here doesn't reload. */
(function () {
  function forward() {
    var h = location.hash;
    if (h.indexOf('#/') === 0 && h.length > 2) {
      location.replace('https://weektally.app/' + h);
    }
  }
  forward();
  window.addEventListener('hashchange', forward);
})();
