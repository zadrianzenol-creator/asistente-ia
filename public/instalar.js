(function () {
  var btn = document.getElementById('installNow'), ev = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); ev = e; btn.hidden = false; });
  btn.onclick = function () {
    if (!ev) return;
    ev.prompt();
    ev.userChoice.finally(function () { ev = null; btn.hidden = true; });
  };
  window.addEventListener('appinstalled', function () { btn.hidden = true; });
  var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  var target = document.getElementById(ios ? 'iphone' : 'android');
  if (target && /android|iphone|ipad|ipod/i.test(navigator.userAgent)) target.scrollIntoView();
})();
