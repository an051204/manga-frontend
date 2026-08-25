(function () {
  function mountHomeButton() {
    if (document.getElementById("api-docs-home-button")) {
      return;
    }

    var button = document.createElement("a");
    button.id = "api-docs-home-button";
    button.href = "/";
    button.setAttribute("aria-label", "Quay về trang mặc định");
    button.textContent = "Về trang chủ";

    var mountPoint = document.querySelector(".swagger-ui") || document.body;
    mountPoint.appendChild(button);
  }

  var attempts = 0;
  var timer = window.setInterval(function () {
    attempts += 1;
    mountHomeButton();

    if (document.getElementById("api-docs-home-button") || attempts >= 20) {
      window.clearInterval(timer);
    }
  }, 150);

  mountHomeButton();
})();
