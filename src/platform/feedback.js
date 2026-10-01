(function (scope) {
  "use strict";
  var script = scope.document.currentScript;
  var popupUrl = new URL("../presentation/overlays/feedback.js", script.src).href;
  scope.adventureFeedback = {
    confirmOpen: function (downloaded) {
      return import(popupUrl).then(function (module) { return module.showFeedback(downloaded); });
    }
  };
}(window));
