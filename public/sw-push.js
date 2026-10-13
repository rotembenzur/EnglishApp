/* Push and notification handlers, imported into the generated service worker (spec 9.6).
 * Payloads come from the lexbites-push Edge Function: {title, body, url, tag, kind}.
 * iOS revokes a subscription that receives pushes without a visible notification, so every push
 * shows one. */
self.addEventListener('push', (event) => {
  let data = { title: 'LexBites', body: '', url: './', tag: 'lexbites' };
  try {
    data = { ...data, ...event.data.json() };
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      lang: 'he',
      dir: 'rtl',
      tag: data.tag,
      data: { url: data.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './', self.registration.scope);
  const home = new URL('./', self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (list) => {
      const client = list.find((c) => 'focus' in c);
      if (!client) return self.clients.openWindow(target.href);
      await client.focus();
      // Open the screen the notification is about (for example the rivalry tab for a nudge).
      if (target.href !== home && 'navigate' in client) return client.navigate(target.href);
      return client;
    }),
  );
});
