import "server-only";

export type InstagramConfig = {
  accessToken: string;
  igUserId: string;
};

export async function sendText(config: InstagramConfig, recipientId: string, text: string) {
  const res = await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${encodeURIComponent(config.accessToken)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
    }),
    cache: "no-store",
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error?.message || `Instagram respondeu ${res.status}`);
  }
  return json;
}
