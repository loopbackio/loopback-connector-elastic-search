/**
 * Per-request options passed to every client call.
 *
 * `meta: true` makes the Elasticsearch 8/9 client resolve to
 * `{ body, statusCode, headers, meta }` instead of the bare body. That is
 * the shape the OpenSearch client always returns, so the rest of the
 * connector can read `{ body }` regardless of distribution. The OpenSearch
 * client ignores the option.
 */
module.exports.REQUEST_OPTIONS = Object.freeze({ meta: true });
