const config = {
  mode: "fixed_servers",
  rules: {
    singleProxy: {
      scheme: "http",
      host: "104.253.13.15",
      port: 5447
    },
    bypassList: ["localhost"]
  }
};

chrome.proxy.settings.set({ value: config, scope: "regular" });

chrome.webRequest.onAuthRequired.addListener(
  function(details) {
    return {
      authCredentials: {
        username: "proxifyipv4",
        password: "poctjocxrsai"
      }
    };
  },
  { urls: ["<all_urls>"] },
  ["blocking"]
);
