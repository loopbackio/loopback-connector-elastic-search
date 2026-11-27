# loopback-connector-esv6

The Elasticsearch and OpenSearch connector for [LoopBack 4](https://loopback.io/).
It stores LoopBack models as documents in a single index and turns LoopBack
filters into search queries.

Despite the package name, it no longer targets Elasticsearch 6. It supports:

| Engine        | Server versions | Client package to install                  |
| ------------- | --------------- | ------------------------------------------ |
| Elasticsearch | 8.19, 9.x       | `@elastic/elasticsearch` 8.x or 9.x        |
| OpenSearch    | 2.x, 3.x        | `@opensearch-project/opensearch` 3.x       |

Elasticsearch 6 and 7 are end-of-life. Use version 2 of this connector if you
still need them.

## Contents

- [Installation](#installation)
- [Creating a datasource](#creating-a-datasource)
- [Configuration options](#configuration-options)
- [Client configuration](#client-configuration)
- [The index and its mapping](#the-index-and-its-mapping)
- [Defining models](#defining-models)
- [Querying](#querying)
- [Pagination with `search_after`](#pagination-with-search_after)
- [Total hit count](#total-hit-count)
- [Write consistency](#write-consistency)
- [Recipes](#recipes)
- [Limitations](#limitations)
- [Debugging](#debugging)
- [Upgrading from 2.x](#upgrading-from-2x)
- [Development](#development)
- [Contributing](#contributing)

## Installation

Install the connector and the client for your engine. The client is a peer
dependency: the connector does not bundle one.

```sh
npm install loopback-connector-esv6

# Elasticsearch 9.x
npm install @elastic/elasticsearch@9
# Elasticsearch 8.19 (this client also works with Elasticsearch 9.x)
npm install @elastic/elasticsearch@8
# OpenSearch 2.x or 3.x
npm install @opensearch-project/opensearch@3
```

The 9.x Elasticsearch client cannot connect to Elasticsearch 8. If the client
is missing, or is newer than the server `version` you configure, the connector
throws an error that names the package to install.

Node.js 22 or newer is required.

## Creating a datasource

Run `lb4 datasource`, choose **other** as the connector, and enter `esv6`.
Then edit the generated `src/datasources/search.datasource.ts`:

```ts
import {inject, lifeCycleObserver, LifeCycleObserver} from '@loopback/core';
import {juggler} from '@loopback/repository';

const config = {
  name: 'search',
  connector: 'esv6',
  version: 9,
  index: 'my-app',
  configuration: {
    node: 'http://localhost:9200',
    auth: {apiKey: process.env.ELASTICSEARCH_API_KEY},
  },
  mappingProperties: {
    title: {type: 'text'},
    status: {type: 'keyword'},
    created: {type: 'date'},
  },
};

@lifeCycleObserver('datasource')
export class SearchDataSource
  extends juggler.DataSource
  implements LifeCycleObserver
{
  static dataSourceName = 'search';
  static readonly defaultConfig = config;

  constructor(
    @inject('datasources.config.search', {optional: true})
    dsConfig: object = config,
  ) {
    super(dsConfig);
  }
}
```

For OpenSearch, add `distribution: 'opensearch'` and set `version` to the
OpenSearch major version (`2` or `3`).

To keep connection details out of source control, bind the configuration at
startup instead, for example in `src/application.ts`:

```ts
this.bind('datasources.config.search').to({
  ...SearchDataSource.defaultConfig,
  configuration: {
    node: process.env.ELASTICSEARCH_URL,
    auth: {apiKey: process.env.ELASTICSEARCH_API_KEY},
  },
});
```

## Configuration options

| Option              | Type   | Required | Default           | Description |
| ------------------- | ------ | -------- | ----------------- | ----------- |
| `connector`         | string | Yes      |                   | `esv6`. |
| `name`              | string | No       |                   | Datasource name. |
| `version`           | number | Yes      |                   | Server major version: `8` or `9` for Elasticsearch, `2` or `3` for OpenSearch. With any other value the connector is not initialized. |
| `distribution`      | string | No       | `elasticsearch`   | `elasticsearch` or `opensearch`. Selects the client package. |
| `index`             | string | Yes      |                   | The index that holds every model of this datasource. |
| `configuration`     | object | Yes      |                   | Options passed to the client constructor. See [Client configuration](#client-configuration). |
| `mappingProperties` | object | No       |                   | Field mappings for the index. When set, the connector creates or updates the index on connect. See [The index and its mapping](#the-index-and-its-mapping). |
| `indexSettings`     | object | No       | `{}`              | Index settings used when the connector creates the index, such as `number_of_shards`. |
| `defaultSize`       | number | No       | `50`              | Maximum hits returned by a query without `limit`. |
| `debug`             | boolean | No      | `false`           | Log the settings and the documents of write calls. Setting `DEBUG=loopback:connector:elasticsearch` also turns this on. |

## Client configuration

`configuration` is passed to the client as it is, so any option from the
[Elasticsearch client](https://www.elastic.co/guide/en/elasticsearch/client/javascript-api/current/client-configuration.html)
or the [OpenSearch client](https://opensearch.org/docs/latest/clients/javascript/index/)
works. Common ones:

| Option           | Description |
| ---------------- | ----------- |
| `node` / `nodes` | Server URL, or a list of URLs. |
| `cloud.id`       | Elastic Cloud deployment id, in place of `node` (Elasticsearch only). |
| `auth`           | `{username, password}`, or `{apiKey}` / `{bearer}` with Elasticsearch. |
| `requestTimeout` | Request timeout in milliseconds. |
| `tls` / `ssl`    | TLS options. The Elasticsearch client reads `tls`; the OpenSearch client reads `ssl`. |

For TLS, `ca`, `cert` and `key` may be file paths. The connector reads them
before creating the client:

```ts
configuration: {
  node: 'https://search.internal:9200',
  tls: {ca: '/etc/ssl/search-ca.pem', rejectUnauthorized: true}, // Elasticsearch
  // ssl: {ca: '/etc/ssl/search-ca.pem'},                       // OpenSearch
},
```

## The index and its mapping

- **One index per datasource.** Every model of the datasource is stored in
  `index`. The connector adds a `docType` keyword field holding the model name,
  and every query filters on it, so models do not see each other's documents.
- **Index setup happens on connect.** When `mappingProperties` is set, the
  connector creates the index with `indexSettings` and the mapping if the index
  does not exist, or adds the mapping to an existing index. `docType` is added
  to the mapping for you.
- **Mapping errors do not stop the app.** If setup fails, for example because a
  field's type cannot change, the error is only logged (see
  [Debugging](#debugging)). Check the mapping when fields do not behave as
  expected.
- **`automigrate` does not change the index.** `npm run migrate` succeeds but
  does not drop or recreate anything, and `autoupdate` is not implemented.
  Manage index lifecycle, reindexing and aliases with the engine's own tools.

Map the fields you filter or sort on explicitly. Without a mapping, the engine
maps strings as `text`, which cannot be sorted and matches individual words.
Use `keyword` for exact matches and sorting.

## Defining models

Models are ordinary LoopBack 4 entities:

```ts
import {Entity, model, property} from '@loopback/repository';

@model()
export class Article extends Entity {
  @property({type: 'string', id: true, generated: true})
  id?: string;

  @property({type: 'string', required: true})
  title: string;

  @property({type: 'string'})
  status?: string;

  @property({type: 'date'})
  created?: Date;
}
```

Use the `DefaultCrudRepository` generated by `lb4 repository` with the
`search` datasource.

**Ids.** With `generated: true`, the engine generates the id and it is stored
as the document `_id`. With a client-supplied id (`generated: false`, or an id
property such as `{type: 'number', id: true}`), the value becomes the `_id` and
is also stored in the document, so you can sort on it.

**Values read back.** Values are converted to the declared property type:
`string`, `number` and `date` properties come back as strings, numbers and
`Date` objects, and array properties come back as arrays.

## Querying

LoopBack filters are translated into a `bool` query.

| Filter                                 | Elasticsearch / OpenSearch query |
| -------------------------------------- | -------------------------------- |
| `{field: value}`                       | `match`, or `match_phrase` for strings with spaces |
| `and`, `or`                            | `bool.must`, `bool.should` |
| `neq`                                  | `term` inside `bool.must_not` (exact match) |
| `gt`, `gte`, `lt`, `lte`, `between`    | `range` |
| `inq`, `nin`                           | `terms`, or `must_not` + `terms` |
| `like`, `nlike`                        | `regexp`, or `must_not` + `regexp` (the value is a regular expression, not a SQL pattern) |
| `geo_distance`, `geo_bounding_box`, `geo_shape` | The value is used as the body of that geo query, in a filter |
| `limit`, `skip` / `offset`             | `size`, `from` |
| `order`                                | `sort` |
| `fields`                               | `_source` filtering |

Conditions on fields mapped as `nested` are wrapped in `nested` queries.

Things to know:

- `{field: value}` on a `text` field is a full-text match, not an exact match.
  Map the field as `keyword` for exact matches.
- **Default order.** A query without `order` is sorted by the id when the id is
  stored in the document. For models with generated ids, there is no default
  order, because Elasticsearch 8+ cannot sort on `_id` without enabling
  fielddata. Pass `order` whenever the order matters.
- `skip` / `offset` is limited by the index's `max_result_window` (10,000 by
  default). Use [`search_after`](#pagination-with-search_after) for deeper
  pages.
- `include` works, through LoopBack's relation resolver.
- Native query DSL is not accepted. It is disabled until it can be limited to
  the requesting model's documents.

## Pagination with `search_after`

To page through large result sets, add a `_search_after` property to the model.
Each result then carries the sort values of its hit. Pass the last result's
values as `searchafter` to get the next page:

```ts
@property({type: 'array', itemType: 'any'})
_search_after?: unknown[];
```

```ts
const filter = {order: ['created DESC'], limit: 20};
const page1 = await articleRepository.find(filter);

const page2 = await articleRepository.find({
  ...filter,
  searchafter: page1[page1.length - 1]._search_after,
} as Filter<Article>);
```

`searchafter` is not part of LoopBack's `Filter` type, hence the cast.

- Always pass `order`. Add a unique field such as the id as the last sort key
  so that hits with equal values are not skipped.
- `skip` is ignored when `searchafter` is set.
- To go back a page, reverse the order.

## Total hit count

Add a `_total_count` property to the model to get the total number of hits for
the query (not only the returned page) on every result:

```ts
@property({type: 'number'})
_total_count?: number;
```

The connector never writes `_search_after` or `_total_count` to the index.

## Write consistency

`create`, `save`, `update`, `replaceById`, `updateById`, `updateAll`,
`deleteById` and `deleteAll` wait for the index to refresh
(`refresh: true`). A write is visible to the next query, at the cost of slower
writes. This is not configurable yet; bulk loads are faster through the
engine's bulk API.

## Recipes

The recipes use the `Article` model from [Defining models](#defining-models),
extended where a recipe needs more fields, and an `articleRepository` created
by `lb4 repository`. They assume this mapping:

```ts
mappingProperties: {
  title: {type: 'text'},      // full-text search
  status: {type: 'keyword'},  // exact match and sorting
  slug: {type: 'keyword'},
  views: {type: 'integer'},
  tags: {type: 'keyword'},
  created: {type: 'date'},
},
```

### Basics

#### Create, read, update and delete

```ts
const article = await articleRepository.create({
  title: 'Getting started with LoopBack',
  status: 'draft',
  slug: 'lb-start',
  created: new Date(),
});

const found = await articleRepository.findById(article.id);
await articleRepository.updateById(article.id, {status: 'published'});
await articleRepository.replaceById(article.id, {...found, views: 0});
await articleRepository.deleteById(article.id);
```

Writes wait for a refresh, so the next query sees them (see
[Write consistency](#write-consistency)).

#### Filter, sort and limit

```ts
const latest = await articleRepository.find({
  where: {status: 'published'},
  order: ['created DESC'],
  limit: 10,
});

const {count} = await articleRepository.count({status: 'published'});
```

#### Ranges, lists and alternatives

```ts
// Created between two dates (inclusive)
await articleRepository.find({
  where: {created: {between: ['2026-02-01', '2026-06-01']}},
});

// At least 50 views
await articleRepository.find({where: {views: {gte: 50}}});

// Tagged with any of these. On an array field, a document matches when any
// element matches.
await articleRepository.find({
  where: {tags: {inq: ['opensearch', 'elasticsearch']}},
});

// Drafts, or anything with more than 100 views
await articleRepository.find({
  where: {or: [{status: 'draft'}, {views: {gt: 100}}]},
});
```

#### Pages with `limit` and `skip`

```ts
const page = 3;
const pageSize = 20;
await articleRepository.find({
  order: ['created DESC'],
  limit: pageSize,
  skip: (page - 1) * pageSize,
});
```

`skip + limit` cannot go past the index's `max_result_window` (10,000 by
default). For deeper pages, use [`search_after`](#pagination-with-search_after).
Add [`_total_count`](#total-hit-count) to the model to show the number of
pages.

#### Return only some fields

```ts
await articleRepository.find({fields: {slug: true, views: true}});
```

Only the listed fields are fetched from `_source`.

#### Update or delete many documents

```ts
const {count: archived} = await articleRepository.updateAll(
  {status: 'archived'},
  {created: {lt: '2025-01-01'}},
);

const {count: deleted} = await articleRepository.deleteAll({status: 'archived'});
```

Both run a single update-by-query or delete-by-query request and resolve to
the number of documents changed.

### Elasticsearch and OpenSearch features

#### Full-text search or exact match

How `{field: value}` matches depends on the field's mapping:

```ts
// `title` is `text`: matches any title containing the word "loopback",
// in any case
await articleRepository.find({where: {title: 'loopback'}});

// A string with spaces becomes a phrase query: the words must appear
// together and in this order
await articleRepository.find({where: {title: 'LoopBack and OpenSearch'}});

// `status` is `keyword`: matches the exact value only
await articleRepository.find({where: {status: 'published'}});
```

For models with generated ids, results without `order` come back by relevance. `text` fields cannot
be sorted on. To both search and sort a field, map it as `text` with a
`keyword` sub-field and sort on the sub-field:

```ts
title: {type: 'text', fields: {raw: {type: 'keyword'}}},
```

```ts
await articleRepository.find({
  where: {title: 'loopback'},
  order: ['title.raw ASC'],
} as Filter<Article>);
```

#### Pattern matching

`like` and `nlike` take a
[regular expression](https://www.elastic.co/docs/reference/query-languages/query-dsl/regexp-syntax),
not a SQL pattern, and the whole value must match it. Use them on `keyword`
fields:

```ts
// slugs starting with "lb-"
await articleRepository.find({where: {slug: {like: 'lb-.*'}}});

// all other slugs
await articleRepository.find({where: {slug: {nlike: 'lb-.*'}}});
```

#### Search inside nested objects

Map an array of objects as `nested` to match conditions against each object
on its own. Query its fields with a dotted path:

```ts
mappingProperties: {
  comments: {
    type: 'nested',
    properties: {author: {type: 'keyword'}, body: {type: 'text'}},
  },
},
```

```ts
@property({type: 'array', itemType: 'object'})
comments?: {author: string; body: string}[];
```

```ts
await articleRepository.find({
  where: {'comments.author': 'ben'},
} as Filter<Article>);
```

LoopBack's `Filter` type does not accept dotted paths, hence the cast. Every
condition on a nested path becomes its own `nested` query.

#### Find documents near a place

Map the field as `geo_point` (or `geo_shape` for areas) and declare it as an
object property:

```ts
mappingProperties: {
  location: {type: 'geo_point'},
},
```

```ts
@property({type: 'object'})
location?: {lat: number; lon: number};
```

The value of a geo operator is passed to the engine as the body of that
query, so it repeats the field name as in the query DSL:

```ts
// within 20 km of a point
await articleRepository.find({
  where: {
    location: {
      geo_distance: {distance: '20km', location: {lat: 3.1579, lon: 101.7116}},
    },
  },
} as Filter<Article>);

// inside a box
await articleRepository.find({
  where: {
    location: {
      geo_bounding_box: {
        location: {
          top_left: {lat: 7, lon: 99.5},
          bottom_right: {lat: 1.5, lon: 104.5},
        },
      },
    },
  },
} as Filter<Article>);

// a `geo_shape` field whose shape intersects an envelope
await placeRepository.find({
  where: {
    area: {
      geo_shape: {
        area: {
          shape: {type: 'envelope', coordinates: [[103.75, 1.4], [103.95, 1.2]]},
          relation: 'intersects',
        },
      },
    },
  },
} as Filter<Place>);
```

Geo conditions run in filter context, so they do not affect relevance, and
they combine with other conditions and with `and` / `or`. Sorting by distance
is not supported through `order`.

#### Aggregations and other queries

For anything the LoopBack filter cannot express, such as aggregations,
suggesters or highlighting, call the client the connector created. Filter on
`docType` to stay within one model's documents:

```ts
// `db` is the client instance; it is typed as `any`
const client = this.dataSource.connector!.db;
const result = await client.search({
  index: 'my-app',
  body: {
    size: 0,
    query: {term: {docType: 'Article'}},
    aggs: {by_status: {terms: {field: 'status'}}},
  },
});
const buckets = result.aggregations?.by_status;
```

Passing the request under `body` works with both clients. The Elasticsearch
client resolves to the response body. The OpenSearch client resolves to
`{body, statusCode, ...}`, so read `result.body.aggregations` there.

#### Connect to Elastic Cloud

```ts
configuration: {
  cloud: {id: process.env.ELASTIC_CLOUD_ID},
  auth: {apiKey: process.env.ELASTICSEARCH_API_KEY},
},
```

#### Connect to OpenSearch with a private CA

```ts
const config = {
  name: 'search',
  connector: 'esv6',
  distribution: 'opensearch',
  version: 3,
  index: 'my-app',
  configuration: {
    node: 'https://opensearch.internal:9200',
    auth: {
      username: process.env.OPENSEARCH_USER,
      password: process.env.OPENSEARCH_PASSWORD,
    },
    ssl: {ca: '/etc/ssl/opensearch-ca.pem'},
  },
};
```

`ssl.ca`, `ssl.cert` and `ssl.key` may be file paths; the connector reads
them. With Elasticsearch, put the same options under `tls`.

#### Keep models in separate indices

A datasource uses one index for all its models. To give a model its own index,
for example to tune its mapping or shard count, create a second datasource
with a different `index` and use it in that model's repository:

```ts
// src/datasources/logs.datasource.ts
const config = {
  name: 'logs',
  connector: 'esv6',
  version: 9,
  index: 'my-app-logs',
  indexSettings: {number_of_shards: 3},
  configuration: {node: process.env.ELASTICSEARCH_URL},
  mappingProperties: {message: {type: 'text'}, level: {type: 'keyword'}},
};
```

## Limitations

- One index per datasource.
- No transactions.
- No native query DSL.
- `automigrate` and `autoupdate` do not manage the index.
- Elasticsearch 6 and 7 are not supported by this version.

## Debugging

Set the `DEBUG` environment variable to see what the connector sends:

```sh
DEBUG=loopback:connector:elasticsearch npm start
```

Index setup failures and failed requests are logged under the same name.

## Upgrading from 2.x

- Install the client yourself (see [Installation](#installation)).
- Use Elasticsearch 8.19 or newer, or OpenSearch 2 or 3, and set `version` to
  the server's major version.
- Remove `mappingType`. Mapping types no longer exist.
- Rename `configuration.ssl` to `configuration.tls` for Elasticsearch.
- Add `order` to queries on models with generated ids if you relied on the old
  default sort on `_id`.
- Node.js 22 or newer is required.

## Development

The tests need a running server. For example, with Docker:

```sh
docker run -d -p 9200:9200 -e discovery.type=single-node \
  -e xpack.security.enabled=false docker.elastic.co/elasticsearch/elasticsearch:9.5.7
npm test
```

These environment variables select the server:

| Variable              | Default                 | Description |
| --------------------- | ----------------------- | ----------- |
| `ELASTICSEARCH_URL`   | `http://localhost:9200` | Server URL. |
| `SEARCH_VERSION`      | `9`                     | Server major version. |
| `SEARCH_DISTRIBUTION` | `elasticsearch`         | `elasticsearch` or `opensearch`. |

For Elasticsearch 8, install the 8.x client first:
`npm install --no-save @elastic/elasticsearch@8`. For OpenSearch, run
`opensearchproject/opensearch` with `DISABLE_SECURITY_PLUGIN=true`.

CI runs the suite against every supported Elasticsearch and OpenSearch release
line on every Node.js LTS and Current release.

## Contributing

Open issues and pull requests at
[loopbackio/loopback-connector-elastic-search](https://github.com/loopbackio/loopback-connector-elastic-search).
Report security issues as described in [SECURITY.md](SECURITY.md).
