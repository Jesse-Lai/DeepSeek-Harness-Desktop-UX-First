const params = new URLSearchParams(window.location.search);

if (params.get("state") === "error") {
  document.documentElement.dataset.state = "error";
  document.querySelector("#title").textContent = "DeepSeek Harness 启动失败";
  document.querySelector("#message").textContent =
    params.get("message") ?? "请退出应用后重试。";
}
