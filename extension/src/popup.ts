void chrome.runtime.sendMessage({ type: "status" }).then(status => {
  document.getElementById("status")!.textContent = status.waiting ? `Waiting for your ${status.resource === "sections" ? "class search" : "transcript"} page.` : "Ready. No import in progress.";
}).catch(() => { document.getElementById("status")!.textContent = "Connection unavailable. Reload the extension."; });
