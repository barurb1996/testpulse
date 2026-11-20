  (function () {
    var btn = document.getElementById('copy-cmd'), hint = document.getElementById('copy-hint');
    btn.addEventListener('click', function () {
      var done = function () { hint.textContent = 'copied'; setTimeout(function () { hint.textContent = 'click to copy'; }, 1500); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText('npx testpulse ./e2e').then(done, function () {});
    });
  })();
