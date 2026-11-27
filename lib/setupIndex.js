const log = require('debug')('loopback:connector:elasticsearch');
const { REQUEST_OPTIONS } = require('./requestOptions');

async function setupIndex() {
  const self = this;
  const {
    db,
    index,
    settings: {
      mappingProperties,
      indexSettings
    }
  } = self;
  const { body: exists } = await db.indices.exists({
    index
  }, REQUEST_OPTIONS);
  mappingProperties.docType = {
    type: 'keyword',
    index: true
  };
  const mapping = {
    properties: mappingProperties
  };
  if (!exists) {
    log('ESConnector.prototype.setupIndex', 'create index with mapping for', index);
    await db.indices.create({
      index,
      body: {
        settings: indexSettings,
        mappings: mapping
      }
    }, REQUEST_OPTIONS);
    return Promise.resolve();
  }
  const updateMapping = {
    index,
    body: mapping
  };
  log('ESConnector.prototype.setupIndex', 'update mapping for index', index);
  await db.indices.putMapping(updateMapping, REQUEST_OPTIONS);
  return Promise.resolve();
}

module.exports.setupIndex = setupIndex;
