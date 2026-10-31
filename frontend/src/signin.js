(function () {
  var password = document.getElementById('signin-password');
  var toggle = document.getElementById('signin-show');
  if (password && toggle) {
    toggle.addEventListener('click', function () {
      var showing = password.type === 'password';
      password.type = showing ? 'text' : 'password';
      toggle.textContent = showing ? 'Hide' : 'Show';
    });
  }
  [
    ['signin-forgot', 'signin-forgot-hint'],
    ['signin-create', 'signin-create-hint'],
  ].forEach(function (pair) {
    var button = document.getElementById(pair[0]);
    var hint = document.getElementById(pair[1]);
    if (button && hint) {
      button.addEventListener('click', function () {
        hint.hidden = !hint.hidden;
      });
    }
  });
})();
