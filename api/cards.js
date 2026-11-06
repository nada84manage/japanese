const CARD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABLE_URL = "/rest/v1/kokugo_cards";

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");

  const projectUrl = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const apiKey = process.env.SUPABASE_ANON_KEY;
  if (!projectUrl || !apiKey) {
    response.status(500).json({ error: "Vercel環境変数 SUPABASE_URL / SUPABASE_ANON_KEY が未設定です。" });
    return;
  }

  let url;
  try {
    url = new URL(projectUrl);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co")) {
      throw new Error("Invalid Supabase URL");
    }
  } catch {
    response.status(500).json({ error: "SUPABASE_URL の形式が正しくありません。" });
    return;
  }

  let path;
  let method = request.method;
  const headers = {
    apikey: apiKey
  };
  if (!apiKey.startsWith("sb_publishable_")) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  let body;

  if (method === "GET") {
    path = `${TABLE_URL}?select=id,position,page,question&order=position.asc`;
  } else if (method === "POST") {
    if (!Array.isArray(request.body) || request.body.length > 2000) {
      response.status(400).json({ error: "カードデータの形式が正しくありません。" });
      return;
    }
    if (request.body.length === 0) {
      response.status(204).end();
      return;
    }

    const cards = request.body;
    const valid = cards.every((card) =>
      card &&
      typeof card.id === "string" &&
      CARD_ID_PATTERN.test(card.id) &&
      Number.isInteger(card.position) &&
      card.position >= 0 &&
      typeof card.page === "string" &&
      card.page.length <= 64 &&
      typeof card.question === "string" &&
      card.question.length <= 10000
    );
    if (!valid) {
      response.status(400).json({ error: "カードのページまたは問題文が正しくありません。" });
      return;
    }

    path = `${TABLE_URL}?on_conflict=id`;
    method = "POST";
    headers["Content-Type"] = "application/json";
    headers.Prefer = "resolution=merge-duplicates,return=minimal";
    body = JSON.stringify(cards);
  } else if (method === "DELETE") {
    const id = typeof request.query?.id === "string" ? request.query.id : "";
    if (!CARD_ID_PATTERN.test(id)) {
      response.status(400).json({ error: "カードIDが正しくありません。" });
      return;
    }
    path = `${TABLE_URL}?id=eq.${encodeURIComponent(id)}`;
    method = "DELETE";
    headers.Prefer = "return=minimal";
  } else {
    response.setHeader("Allow", "GET, POST, DELETE");
    response.status(405).json({ error: "この操作は許可されていません。" });
    return;
  }

  try {
    const upstream = await fetch(`${url.origin}${path}`, { method, headers, body });
    const result = await upstream.text();
    response.status(upstream.status);
    if (result) {
      response.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
      response.send(result);
    } else {
      response.end();
    }
  } catch (error) {
    console.error("Supabase request failed", error);
    response.status(502).json({ error: "Supabaseに接続できませんでした。" });
  }
};
