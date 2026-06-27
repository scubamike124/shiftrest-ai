// RestPilot AI — push notification service worker.
// Scope: handle 'push' + 'notificationclick' only. No app-shell caching.

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = { title: "RestPilot AI", body: "You have a new reminder." };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    if (event.data) data.body = event.data.text();
  }
  const isAlarm = data.kind === "smart-alarm";
  const options = {
    body: data.body,
    icon: "/icon-512.png",
    badge: "/icon-512.png",
    tag: data.tag || data.kind || "restpilot",
    data: { url: data.url || "/plan", kind: data.kind || null },
    // Smart alarms must wake the user — keep the notification on screen until
    // tapped and use a long buzzing vibration pattern.
    requireInteraction: isAlarm,
    silent: false,
    vibrate: isAlarm
      ? [400, 200, 400, 200, 400, 200, 400, 200, 400]
      : [80, 40, 80],
  };
  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        if ("focus" in client) {
          client.focus();
          if ("navigate" in client) client.navigate(url);
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(url);
    })(),
  );
});
