// 本地服务的 POST 收口：method / content-type / origin 三重校验。
// 背景：浏览器里任意网页都能用 text/plain（simple request，免预检）向 127.0.0.1 跨站
// POST——服务端若只看 body 不看头，/api/delete 等状态变更路由会被直达。
// 返回 0 表示放行，否则为应答的 HTTP 状态码。

const MAX_BODY_BYTES = 65536;

export function guardPost(req) {
  if (req.method !== 'POST') return 405;
  const ct = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (ct !== 'application/json') return 415;
  // Origin 不存在（curl / 同源 fetch 的部分实现）放行；存在则必须与 Host 同源。
  const origin = req.headers.origin;
  if (origin !== undefined) {
    try {
      const o = new URL(origin);
      if (o.host !== req.headers.host) return 403;
    } catch {
      return 403;
    }
  }
  return 0;
}

export { MAX_BODY_BYTES };
