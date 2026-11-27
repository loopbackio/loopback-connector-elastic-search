const fs = require('fs');
const path = require('path');
const _ = require('lodash');
const R = require('ramda');

const log = require('debug')('loopback:connector:elasticsearch');

// Server major versions that are not end-of-life, per distribution
const SupportedVersions = {
  elasticsearch: [8, 9],
  opensearch: [2, 3]
};
// 'Client' is assigned the Elasticsearch or OpenSearch client class in initialize()
let Client = null;
const { Connector } = require('loopback-connector');
const automigrate = require('./automigrate')({
  log
});
const { REQUEST_OPTIONS } = require('./requestOptions');
const { setupIndex } = require('./setupIndex');
const { all } = require('./all');
const { buildDeepNestedQueries } = require('./buildDeepNestedQueries');
const { buildNestedQueries } = require('./buildNestedQueries');
const { buildFilter } = require('./buildFilter');
const { buildOrder } = require('./buildOrder');
const { buildWhere } = require('./buildWhere');
const { count } = require('./count');
const { create } = require('./create');
const { destroy } = require('./destroy');
const { destroyAll } = require('./destroyAll');
const { exists } = require('./exists');
const { find } = require('./find');
const { replaceById } = require('./replaceById');
const { replaceOrCreate } = require('./replaceOrCreate');
const { save } = require('./save');
const { updateAll } = require('./updateAll');
const { updateAttributes } = require('./updateAttributes');
const { updateOrCreate } = require('./updateOrCreate');

// CONSTANTS
const SEARCHAFTERKEY = '_search_after';
const TOTALCOUNTKEY = '_total_count';

/**
 * Elasticsearch connector for LoopBack.
 *
 * Methods whose implementation lives in its own module under `lib/` delegate
 * to it with the same parameter list, because loopback-datasource-juggler
 * inspects `connector[method].length` to decide whether to pass `options`.
 */
class ESConnector extends Connector {
  /**
   * Connector constructor
   * @param {object} settings datasource settings
   * @param {object} dataSource
   * @constructor
   */
  constructor(settings, dataSource) {
    super('elasticsearch', settings);
    const defaultRefreshIndexAPIs = [
      'create',
      'save',
      'destroy',
      'destroyAll',
      'updateAttributes',
      'updateOrCreate',
      'updateAll',
      'replaceOrCreate',
      'replaceById'
    ];
    this.configuration = settings.configuration || {};
    this.version = settings.version;
    this.index = settings.index;
    this.indexSettings = settings.indexSettings || {};
    this.defaultSize = (settings.defaultSize || 50);
    this.idField = 'id';
    this.refreshOn = defaultRefreshIndexAPIs;

    this.debug = settings.debug || log.enabled;
    if (this.debug) {
      log('Settings: %j', settings);
    }

    this.dataSource = dataSource;
  }

  /**
   * Generate a client configuration object based on settings.
   */
  getClientConfig() {
    // https://www.elastic.co/guide/en/elasticsearch/client/javascript-api/current/client-configuration.html
    const self = this;
    const config = self.settings.configuration;

    // TLS options are `tls` in the Elasticsearch 8/9 client and `ssl` in the
    // OpenSearch client. `ca`, `cert` and `key` given as file paths are read.
    ['tls', 'ssl'].forEach((optionName) => {
      const tlsOptions = config[optionName];
      if (!tlsOptions) {
        return;
      }
      const fskeys = ['ca', 'cert', 'key'];
      R.forEach((key) => {
        if (R.has(key, tlsOptions)) {
          tlsOptions[key] = fs.readFileSync(tlsOptions[key]);
        }
      }, fskeys);
    });
    // Note: https://www.elastic.co/guide/en/elasticsearch/client/javascript-api/current/client-configuration.html
    return config;
  }

  /**
   * Connect to Elasticsearch client
   * @param {Function} [callback] The callback function
   *
   * @callback callback
   * @param {Error} err The error object
   * @param {Db} db The elasticsearch client
   */
  connect(callback) {
    // TODO: throw error if callback isn't provided?
    //       what are the corner-cases when the loopback framework does not provide callback
    //       and we need to be able to live with that?
    const self = this;
    if (!self.db) {
      self.db = new Client(self.getClientConfig());
      self.ping(() => {
        //
      });
      // Every caller waits for the index setup, including callers that
      // arrive while it is still running (juggler calls connect() from
      // initialize() and again from dataSource.connect()).
      self.connecting = self.settings.mappingProperties
        ? self.setupIndex()
          .then(() => {
            log('ESConnector.prototype.connect', 'setupIndex', 'finished');
          })
          .catch((err) => {
            log('ESConnector.prototype.connect', 'setupIndex', 'failed', err);
          })
        : Promise.resolve();
    }
    self.connecting.then(() => {
      callback(null, self.db);
    });
  }

  setupIndex() {
    return setupIndex.call(this);
  }

  /**
   * Ping to test elastic connection
   * @returns {String} with ping result
   */
  ping(cb) {
    const self = this;
    self.db.ping(undefined, REQUEST_OPTIONS).then(() => {
      log('Pinged ES successfully.');
      cb();
    }).catch((error) => {
      log('Could not ping ES.');
      cb(error);
    });
  }

  /**
   * Return connector type
   * @returns {String} type description
   */
  getTypes() {
    return [this.name];
  }

  /**
   * Get value from property checking type
   * @param {object} property
   * @param {String} value
   * @returns {object}
   */
  // eslint-disable-next-line class-methods-use-this
  getValueFromProperty(property, value) {
    if (property.type instanceof Array) {
      if (!value || (value.length === 0)) {
        return [];
      }
      return value;
    } if (property.type === String) {
      return value.toString();
    } if (property.type === Number) {
      return Number(value);
    } if (property.type === Date) {
      return new Date(value);
    }
    return value;
  }

  /**
   * Match and transform data structure to modelName
   * @param {String} modelName name
   * @param {Object} data from DB
   * @returns {object} modeled document
   */
  matchDataToModel(modelName, data, esId, idName, sort, docsCount) {
    /*
    log('ESConnector.prototype.matchDataToModel', 'modelName',
      modelName, 'data', JSON.stringify(data,null,0));
    */
    const self = this;
    if (!data) {
      return null;
    }
    try {
      const document = {};

      // eslint-disable-next-line no-underscore-dangle
      const { properties } = this._models[modelName];
      _.assign(document, data); // it can't be this easy, can it?
      document[idName] = esId;

      Object.keys(properties).forEach((propertyName) => {
        const propertyValue = data[propertyName];
        // log('ESConnector.prototype.matchDataToModel', propertyName, propertyValue);
        if (propertyValue !== undefined && propertyValue !== null) {
          document[propertyName] = self.getValueFromProperty(
            properties[propertyName],
            propertyValue
          );
        }
      });
      document[SEARCHAFTERKEY] = sort;
      document[TOTALCOUNTKEY] = docsCount;
      log('ESConnector.prototype.matchDataToModel', 'document', JSON.stringify(document, null, 0));
      return document;
    } catch (err) {
      log('ESConnector.prototype.matchDataToModel', err.message);
      return null;
    }
  }

  /**
   * Convert data source to model
   * @param {String} model name
   * @param {Object} data object
   * @returns {object} modeled document
   */
  dataSourceToModel(modelName, data, idName, totalCount) {
    log('ESConnector.prototype.dataSourceToModel', 'modelName', modelName, 'data', JSON.stringify(data, null, 0));

    // return data._source; // TODO: super-simplify?
    // eslint-disable-next-line no-underscore-dangle
    return this.matchDataToModel(
      modelName,
      // eslint-disable-next-line no-underscore-dangle
      data._source,
      // eslint-disable-next-line no-underscore-dangle
      data._id,
      idName,
      data.sort || [],
      totalCount
    );
  }

  /**
   * Add defaults such as index name and refresh
   *
   * @param {String} modelName
   * @param {String} functionName The caller function name
   * @returns {object} Filter with index and refresh
   */
  addDefaults(modelName, functionName) {
    const self = this;
    log('ESConnector.prototype.addDefaults', 'modelName:', modelName);
    const filter = {
      index: self.settings.index
    };

    // When changing data, wait until the change has been indexed...
    // ...so it is instantly available for search
    if (this.refreshOn.indexOf(functionName) !== -1) {
      filter.refresh = true;
    }

    log('ESConnector.prototype.addDefaults', 'filter:', filter);
    return filter;
  }

  /**
   * Make filter from criteria, data index and type
   * Ex:
   *   {'body': {'query': {'match': {'title': 'Futuro'}}}}
   *   {'q' : 'Futuro'}
   * @param {String} modelName filter
   * @param {Object} criteria filter
   * @param {number} size of rows to return, if null then skip
   * @param {number} offset to return, if null then skip
   * @returns {object} filter
   */
  buildFilter(modelName, idName, criteria = {}, size = null, offset = null) {
    return buildFilter.call(this, modelName, idName, criteria, size, offset);
  }

  /**
   * 1. Words of wisdom from @doublemarked:
   *    > When writing a query without an order specified,
        the author should not assume any reliable order.
   *    > So if we’re not assuming any order,
        there is not a compelling reason to potentially slow down
   *    > the query by enforcing a default order.
   * 2. Yet, most connector implementations do enforce a default order ... what to do?
   *
   * @param model
   * @param idName
   * @param order
   * @returns {Array}
   */
  buildOrder(model, idName, order) {
    return buildOrder.call(this, model, idName, order);
  }

  buildWhere(model, idName, where) {
    return buildWhere.call(this, model, idName, where);
  }

  buildNestedQueries(body, model, idName, where, nestedFields) {
    return buildNestedQueries.call(this, body, model, idName, where, nestedFields);
  }

  buildDeepNestedQueries(root, idName, where, body, queryPath, model, nestedFields) {
    return buildDeepNestedQueries.call(
      this, root, idName, where, body, queryPath, model, nestedFields
    );
  }

  /**
   * Get document Id validating data
   * @param {String} id
   * @returns {Number} Id
   * @constructor
   */
  // eslint-disable-next-line class-methods-use-this
  getDocumentId(id) {
    try {
      if (typeof id !== 'string') {
        return id.toString();
      }
      return id;
    } catch (e) {
      return id;
    }
  }

  /**
   * Implement CRUD Level I - Key methods to be implemented by a connector to support full CRUD
   * > Create a new model instance
   *   > create(model, data, callback)
   * > Query model instances by filter
   *   > all(model, filter, callback)
   * > Delete model instances by query
   *   > destroyAll(model, where, callback)
   * > Update model instances by query
   *   > updateAll(model, where, data, callback)
   * > Count model instances by query
   *   > count(model, callback, where)
   * > getDefaultIdType
   *   > very useful for setting a default type for IDs like 'string' rather than 'number'
   */

  // eslint-disable-next-line class-methods-use-this
  getDefaultIdType() {
    return String;
  }

  /**
   * Create a new model instance
   * @param {String} model name
   * @param {object} data info
   * @param {Function} done - invoke the callback with the created model's id as an argument
   */
  create(model, data, done) {
    return create.call(this, model, data, done);
  }

  /**
   * Query model instances by filter
   * @param {String} model The model name
   * @param {Object} filter The filter
   * @param {Function} done callback function
   *
   * NOTE: UNLIKE create() where the ID is returned not as a part of the created content
   * but rather individually as an argument to the callback ... in the all() method
   * it makes sense to return the id with the content! So for a datasource like elasticsearch,
   * make sure to map '_id' into the content, just in case its an auto-generated one.
   */
  all(model, filter, done) {
    return all.call(this, model, filter, done);
  }

  /**
   * Delete model instances by query
   * @param {String} modelName name
   * @param {String} whereClause criteria
   * @param {Function} cb callback
   */
  destroyAll(modelName, whereClause, cb) {
    return destroyAll.call(this, modelName, whereClause, cb);
  }

  /**
   * Update model instances by query
   *
   * NOTES:
   * > Without an update by query plugin, this isn't supported by ES out-of-the-box
   * > To run updateAll these parameters should be enabled in elasticsearch config
   *   -> script.inline: true
   *   -> script.indexed: true
   *   -> script.engine.groovy.inline.search: on
   *   -> script.engine.groovy.inline.update: on
   *
   * @param {String} model The model name
   * @param {Object} where The search criteria
   * @param {Object} data The property/value pairs to be updated
   * @callback {Function} cb - should be invoked with a second callback argument
   *                           that provides the count of affected rows in the callback
   *                           such as cb(err, {count: affectedRows}).
   *                           Notice the second argument is an object with the count property
   *                           representing the number of rows that were updated.
   */
  updateAll(model, where, data, options, cb) {
    return updateAll.call(this, model, where, data, options, cb);
  }

  /**
   * Alias of the built-in updateAll implementation.
   */
  update(model, where, data, options, cb) {
    return updateAll.call(this, model, where, data, options, cb);
  }

  /**
   * Count model instances by query
   * @param {String} model name
   * @param {String} where criteria
   * @param {Function} done callback
   */
  count(modelName, done, where) {
    return count.call(this, modelName, done, where);
  }

  /**
   * Implement CRUD Level II - A connector can choose to implement the following methods,
   *                           otherwise, they will be mapped to those from CRUD Level I.
   * > Find a model instance by id
   *   > find(model, id, callback)
   * > Delete a model instance by id
   *   > destroy(model, id, callback)
   * > Update a model instance by id
   *   > updateAttributes(model, id, data, callback)
   * > Check existence of a model instance by id
   *   > exists(model, id, callback)
   */

  /**
   * Find a model instance by id
   * @param {String} model name
   * @param {String} id row identifier
   * @param {Function} done callback
   */
  find(modelName, id, done) {
    return find.call(this, modelName, id, done);
  }

  /**
   * Delete a model instance by id
   * @param {String} model name
   * @param {String} id row identifier
   * @param {Function} done callback
   */
  destroy(modelName, id, done) {
    return destroy.call(this, modelName, id, done);
  }

  /**
   * Update a model instance by id
   *
   */
  updateAttributes(modelName, id, data, callback) {
    return updateAttributes.call(this, modelName, id, data, callback);
  }

  /**
   * Check existence of a model instance by id
   * @param {String} model name
   * @param {String} id row identifier
   * @param {function} done callback
   */
  exists(modelName, id, done) {
    return exists.call(this, modelName, id, done);
  }

  /**
   * Implement CRUD Level III - A connector can also optimize certain methods
   *                            if the underlying database provides native/atomic
   *                            operations to avoid multiple calls.
   * > Save a model instance
   *   > save(model, data, callback)
   * > Find or create a model instance
   *   > findOrCreate(model, data, callback)
   * > Update or insert a model instance
   *   > updateOrCreate(model, data, callback)
   */

  /**
   * Update document data
   * @param {String} model name
   * @param {Object} data document
   * @param {Function} done callback
   */
  save(model, data, done) {
    return save.call(this, model, data, done);
  }

  /**
   * Find or create a model instance
   */
  // findOrCreate(model, data, callback) {...}

  /**
   * Update or insert a model instance
   * @param modelName
   * @param data
   * @param callback - should pass the following arguments to the callback:
   *                   err object (null on success)
   *                   data object containing the property values as found in the database
   *                   info object providing more details about the result of the operation.
   *                               At the moment, it should have a single property isNewInstance
   *                               with the value true if a new model was created
   *                               and the value false is an existing model was found & updated.
   */
  updateOrCreate(modelName, data, callback) {
    return updateOrCreate.call(this, modelName, data, callback);
  }

  /**
   * replace or insert a model instance
   * @param modelName
   * @param data
   * @param callback - should pass the following arguments to the callback:
   *                   err object (null on success)
   *                   data object containing the property values as found in the database
   *                   info object providing more details about the result of the operation.
   *                               At the moment, it should have a single property isNewInstance
   *                               with the value true if a new model was created
   *                               and the value false is an existing model was found & updated.
   */
  replaceOrCreate(modelName, data, callback) {
    return replaceOrCreate.call(this, modelName, data, callback);
  }

  replaceById(modelName, id, data, options, callback) {
    return replaceById.call(this, modelName, id, data, options, callback);
  }

  /**
   * Migration
   *   automigrate - Create/recreate DB objects (such as table/column/constraint/trigger/index)
   *                 to match the model definitions
   *   autoupdate - Alter DB objects to match the model definitions
   */

  /**
   * Perform automigrate for the given models. Create/recreate DB objects
   * (such as table/column/constraint/trigger/index) to match the model definitions
   *  --> Drop the corresponding indices: both mappings and data are done away with
   *  --> create/recreate mappings and indices
   *
   * @param {String[]} [models] A model name or an array of model names.
   * If not present, apply to all models
   * @param {Function} [cb] The callback function
   */
  automigrate(models, cb) {
    return automigrate.call(this, models, cb);
  }
}

/**
 * Read the installed version of a resolved package. Some clients do not
 * export their package.json, so locate it next to the resolved entry point.
 * @param {String} entry resolved path of the package's main module
 * @param {String} name package name
 * @returns {String} installed version
 */
function installedVersion(entry, name) {
  let dir = path.dirname(entry);
  while (dir !== path.dirname(dir)) {
    const file = path.join(dir, 'package.json');
    if (fs.existsSync(file)) {
      const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (pkg.name === name) {
        return pkg.version;
      }
    }
    dir = path.dirname(dir);
  }
  return undefined;
}

/**
 * Load the client for the configured distribution from the app's own
 * dependencies. Both clients are optional peer dependencies.
 *
 * The Elasticsearch 9 client cannot talk to Elasticsearch 8 (the server
 * rejects its `compatible-with=9` header), while the 8.x client works with
 * both 8.x and 9.x servers through REST API compatibility.
 *
 * @param {String} distribution 'elasticsearch' or 'opensearch'
 * @param {Number} version server major version
 * @returns {Function} the client class
 */
function loadClient(distribution, version) {
  const name = distribution === 'opensearch'
    ? '@opensearch-project/opensearch'
    : '@elastic/elasticsearch';
  const major = distribution === 'opensearch' ? '3' : String(version);
  const installHint = `Run \`npm install ${name}@${major}\` in your application.`;
  let clientModule;
  try {
    clientModule = distribution === 'opensearch'
      ? require('@opensearch-project/opensearch')
      : require('@elastic/elasticsearch');
  } catch (err) {
    if (err.code !== 'MODULE_NOT_FOUND') {
      throw err;
    }
    throw new Error(`loopback-connector-esv6: ${name} is not installed. ${installHint}`);
  }
  if (distribution === 'elasticsearch') {
    const installed = installedVersion(require.resolve('@elastic/elasticsearch'), name);
    const installedMajor = installed && Number(installed.split('.')[0]);
    if (installedMajor && (installedMajor < 8 || installedMajor > version)) {
      throw new Error(`loopback-connector-esv6: settings.version is ${version}, `
        + `but ${name}@${installed} is installed. ${installHint}`);
    }
  }
  return clientModule.Client;
}

/**
 * Initialize connector with datasource, configure settings and return
 * @param {object} dataSource
 * @param {function} done callback
 */
module.exports.initialize = (dataSource, callback) => {
  if (!R.has('settings', dataSource) || !R.has('version', dataSource.settings)) {
    return;
  }
  const { version, distribution = 'elasticsearch' } = dataSource.settings;
  if (!R.has(distribution, SupportedVersions)
    || SupportedVersions[distribution].indexOf(version) === -1) {
    return;
  }
  Client = loadClient(distribution, version);
  const settings = dataSource.settings || {};

  dataSource.connector = new ESConnector(settings, dataSource);

  if (callback) {
    dataSource.connector.connect(callback);
  }
};

module.exports.name = ESConnector.name;
module.exports.ESConnector = ESConnector;
