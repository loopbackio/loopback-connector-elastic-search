/*global getSettings getDataSource expect*/
/*eslint no-console: ["error", { allow: ["trace","log"] }] */
describe('Connector', function() {
  var testConnector;

  before(function() {
    require('./init.js');
    var settings = getSettings();
    settings.log = 'error';
    var datasource = getDataSource(settings);
    testConnector = datasource.connector;

    datasource.define('MockLoopbackModel', {
      // here we want to let elasticsearch auto-populate a field that will be mapped back to loopback as the `id`
      id: { type: String, generated: true, id: true }
    });
  });

  it('should configure defaults when building filters', function(done) {
    var modelName = 'MockLoopbackModel';
    var defaults = testConnector.addDefaults(modelName);

    expect(defaults.index).to.be.a('string').to.have.length.above(1).to.match(/^[a-z0-9._-]+$/i);
    expect(defaults).not.to.have.property('type'); // mapping types were removed in ES 7

    done();
  });

  it('should build a query for the WHERE filter', function(done) {
    var criteria, size, offset, modelName, modelIdName, settings, mappingType;
    criteria = {
      'where': {
        'title': 'Futuro'
      }
    };
    size = 100;
    offset = 10;
    modelName = 'MockLoopbackModel';
    modelIdName = 'id';
    settings = getSettings();
    mappingType = settings.mappingType;

    var filterCriteria = testConnector.buildFilter(modelName, modelIdName, criteria, size, offset);
    expect(filterCriteria).not.to.be.null;
    expect(filterCriteria).to.have.property('index')
      .that.is.a('string');
    expect(filterCriteria).not.to.have.property('type');
    expect(filterCriteria).to.have.property('body')
      .that.is.an('object')
      .that.deep.equals({ // a. this is really 2 tests in one
        // b. no default sort: server-generated ids only exist as `_id`, which
        // Elasticsearch 8+ cannot sort on without fielddata
        query: { // c. here we are testing the bigger picture `should build a query for the WHERE filter`
          bool: {
            filter: [{ term: { docType: modelName } }],
            must: [{
              match: {
                title: 'Futuro'
              }
            }]
          }

        }
      });
    expect(filterCriteria).to.have.property('size')
      .that.is.a('number');
    expect(filterCriteria).to.have.property('from')
      .that.is.a('number');

    done();
  });

  // Native queries are disabled in lib/buildFilter.js until they can be
  // restricted to the requesting model, so this expectation no longer holds.
  it.skip('should use a NATIVE filter query as-is', function(done) {
    var criteria, size, offset, modelName, modelIdName, settings, mappingType;
    criteria = {
      'native': {
        query: {
          bool: {
            must: [{
              match: {
                title: 'Futuro'
              }
            }]
          }
        }
      }
    };
    size = 100;
    offset = 10;
    modelName = 'MockLoopbackModel';
    modelIdName = 'id';
    settings = getSettings();
    mappingType = settings.mappingType;

    var filterCriteria = testConnector.buildFilter(modelName, modelIdName, criteria, size, offset);
    expect(filterCriteria).not.to.be.null;
    expect(filterCriteria).to.have.property('index')
      .that.is.a('string');
    expect(filterCriteria).not.to.have.property('type');
    expect(filterCriteria).to.have.property('body')
      .that.is.an('object')
      .that.deep.equals({
        query: {
          bool: {
            must: [{
              match: {
                title: 'Futuro'
              }
            }]
          }
        }
      });
    expect(filterCriteria).to.have.property('size')
      .that.is.a('number');
    expect(filterCriteria).to.have.property('from')
      .that.is.a('number');

    done();
  });

  it('should build a simple "and" query for the WHERE filter', function(done) {
    var criteria, size, offset, modelName, modelIdName, settings, mappingType;
    criteria = {
      where: {
        and: [
          { name: 'John Lennon' },
          { role: 'lead' }
        ]
      }
    };
    size = 100;
    offset = 10;
    modelName = 'MockLoopbackModel';
    modelIdName = 'id';
    settings = getSettings();
    mappingType = settings.mappingType;

    var filterCriteria = testConnector.buildFilter(modelName, modelIdName, criteria, size, offset);
    expect(filterCriteria).not.to.be.null;
    expect(filterCriteria).to.have.property('index').that.is.a('string');
    expect(filterCriteria).not.to.have.property('type');
    expect(filterCriteria).to.have.property('body')
      .that.is.an('object')
      .that.deep.equals({ // a. this is really 2 tests in one
        // b. no default sort: server-generated ids only exist as `_id`, which
        // Elasticsearch 8+ cannot sort on without fielddata
        query: {
          bool: {
            filter: [{ term: { docType: modelName } }],
            must: [{
                match_phrase: {
                  name: 'John Lennon'
                }
              },
              {
                match: {
                  role: 'lead'
                }
              }
            ]
          }

        }
      });
    expect(filterCriteria).to.have.property('size')
      .that.is.a('number');
    expect(filterCriteria).to.have.property('from')
      .that.is.a('number');

    done();
  });

  it('should build a complex "and"  query with "inq" for the WHERE filter', function(done) {
    var criteria, size, offset, modelName, modelIdName, settings, mappingType;
    criteria = {
      where: {
        and: [
          { id: { inq: [0, 1, 2] } },
          { vip: true }
        ]
      }
    };
    size = 100;
    offset = 10;
    modelName = 'MockLoopbackModel';
    modelIdName = 'id';
    settings = getSettings();
    mappingType = settings.mappingType;

    var filterCriteria = testConnector.buildFilter(modelName, modelIdName, criteria, size, offset);
    expect(filterCriteria).not.to.be.null;
    expect(filterCriteria).to.have.property('index').that.is.a('string');
    expect(filterCriteria).not.to.have.property('type');
    expect(filterCriteria).to.have.property('body')
      .that.is.an('object')
      .that.deep.equals({ // a. this is really 2 tests in one
        // b. no default sort: server-generated ids only exist as `_id`, which
        // Elasticsearch 8+ cannot sort on without fielddata
        query: {
          bool: {
            filter: [{ term: { docType: modelName } }],
            must: [{
                terms: {
                  _id: [
                    0,
                    1,
                    2
                  ]
                }
              },
              {
                match: {
                  vip: true
                }
              }
            ]
          }
        }
      });
    expect(filterCriteria).to.have.property('size')
      .that.is.a('number');
    expect(filterCriteria).to.have.property('from')
      .that.is.a('number');

    done();
  });

  it('should build a nested "or" and "and" query for the WHERE filter', function(done) {
    var criteria, size, offset, modelName, modelIdName, settings, mappingType;
    criteria = {
      where: {
        or: [
          { and: [{ id: { inq: [3, 4, 5] } }, { vip: true }] },
          { role: 'lead' }
        ]
      }
    };
    size = 100;
    offset = 10;
    modelName = 'MockLoopbackModel';
    modelIdName = 'id';
    settings = getSettings();
    mappingType = settings.mappingType;

    var filterCriteria = testConnector.buildFilter(modelName, modelIdName, criteria, size, offset);
    expect(filterCriteria).not.to.be.null;
    expect(filterCriteria).to.have.property('index').that.is.a('string');
    expect(filterCriteria).not.to.have.property('type');
    expect(filterCriteria).to.have.property('body')
      .that.is.an('object')
      .that.deep.equals({ // a. this is really 2 tests in one
        // b. no default sort: server-generated ids only exist as `_id`, which
        // Elasticsearch 8+ cannot sort on without fielddata
        query: {
          bool: {
            filter: [{ term: { docType: modelName } }],
            must: [{
              bool: {
                should: [{
                    bool: {
                      must: [{
                          terms: {
                            _id: [
                              3,
                              4,
                              5
                            ]
                          }
                        },
                        {
                          match: {
                            vip: true
                          }
                        }
                      ]
                    }
                  },
                  {
                    match: {
                      role: 'lead'
                    }
                  }
                ]
              }
            }]
          }
        }
      });
    expect(filterCriteria).to.have.property('size')
      .that.is.a('number');
    expect(filterCriteria).to.have.property('from')
      .that.is.a('number');

    done();
  });

  it('should build a nested "and" and "or" query for the WHERE filter', function(done) {
    var criteria, size, offset, modelName, modelIdName, settings, mappingType;
    criteria = {
      where: {
        and: [
          { or: [{ id: { inq: [3, 4, 5] } }, { vip: true }] },
          { role: 'lead' }
        ]
      }
    };
    size = 100;
    offset = 10;
    modelName = 'MockLoopbackModel';
    modelIdName = 'id';
    settings = getSettings();
    mappingType = settings.mappingType;

    var filterCriteria = testConnector.buildFilter(modelName, modelIdName, criteria, size, offset);
    expect(filterCriteria).not.to.be.null;
    expect(filterCriteria).to.have.property('index').that.is.a('string');
    expect(filterCriteria).not.to.have.property('type');
    expect(filterCriteria).to.have.property('body')
      .that.is.an('object')
      .that.deep.equals({ // a. this is really 2 tests in one
        // b. no default sort: server-generated ids only exist as `_id`, which
        // Elasticsearch 8+ cannot sort on without fielddata
        query: {
          bool: {
            filter: [{ term: { docType: modelName } }],
            must: [{
                bool: {
                  should: [{
                      terms: {
                        _id: [
                          3,
                          4,
                          5
                        ]
                      }
                    },
                    {
                      match: {
                        vip: true
                      }
                    }
                  ]
                }
              },
              {
                match: {
                  role: 'lead'
                }
              }
            ]
          }
        }
      });
    expect(filterCriteria).to.have.property('size')
      .that.is.a('number');
    expect(filterCriteria).to.have.property('from')
      .that.is.a('number');

    done();
  });

  it('should build a "nin" query for the WHERE filter', function(done) {
    var criteria, size, offset, modelName, modelIdName, settings, mappingType;
    criteria = {
      'where': {
        'id': {
          'nin': [0, 1, 2]
        }
      }
    };
    size = 100;
    offset = 10;
    modelName = 'MockLoopbackModel';
    modelIdName = 'id';
    settings = getSettings();
    mappingType = settings.mappingType;

    var filterCriteria = testConnector.buildFilter(modelName, modelIdName, criteria, size, offset);
    expect(filterCriteria).not.to.be.null;
    expect(filterCriteria).to.have.property('index').that.is.a('string');
    expect(filterCriteria).not.to.have.property('type');
    expect(filterCriteria).to.have.property('body')
      .that.is.an('object')
      .that.deep.equals({ // a. this is really 2 tests in one
        // b. no default sort: server-generated ids only exist as `_id`, which
        // Elasticsearch 8+ cannot sort on without fielddata
        query: {
          bool: {
            filter: [{ term: { docType: modelName } }],
            must: [{
              bool: {
                must_not: [{
                  terms: {
                    _id: [
                      0,
                      1,
                      2
                    ]
                  }
                }]
              }
            }]
          }
        }
      });
    expect(filterCriteria).to.have.property('size')
      .that.is.a('number');
    expect(filterCriteria).to.have.property('from')
      .that.is.a('number');

    done();
  });

  it('should build a "and" and "nin" query for the WHERE filter', function(done) {
    var criteria, size, offset, modelName, modelIdName, settings, mappingType;
    criteria = {
      where: {
        and: [
          { id: { nin: [0, 1, 2] } },
          { vip: true }
        ]
      }
    };
    size = 100;
    offset = 10;
    modelName = 'MockLoopbackModel';
    modelIdName = 'id';
    settings = getSettings();
    mappingType = settings.mappingType;

    var filterCriteria = testConnector.buildFilter(modelName, modelIdName, criteria, size, offset);
    expect(filterCriteria).not.to.be.null;
    expect(filterCriteria).to.have.property('index').that.is.a('string');
    expect(filterCriteria).not.to.have.property('type');
    expect(filterCriteria).to.have.property('body')
      .that.is.an('object')
      .that.deep.equals({ // a. this is really 2 tests in one
        // b. no default sort: server-generated ids only exist as `_id`, which
        // Elasticsearch 8+ cannot sort on without fielddata
        query: {
          bool: {
            filter: [{ term: { docType: modelName } }],
            must: [{
                bool: {
                  must_not: [{
                    terms: {
                      _id: [
                        0,
                        1,
                        2
                      ]
                    }
                  }]
                }
              },
              {
                match: {
                  vip: true
                }
              }
            ]
          }
        }
      });
    expect(filterCriteria).to.have.property('size')
      .that.is.a('number');
    expect(filterCriteria).to.have.property('from')
      .that.is.a('number');

    done();
  });

  it('should build a "between" query for the WHERE filter', function(done) {
    var criteria, size, offset, modelName, modelIdName, settings, mappingType;
    criteria = {
      where: {
        order: {
          between: [3, 6]
        }
      }
    };
    size = 100;
    offset = 10;
    modelName = 'MockLoopbackModel';
    modelIdName = 'id';
    settings = getSettings();
    mappingType = settings.mappingType;

    var filterCriteria = testConnector.buildFilter(modelName, modelIdName, criteria, size, offset);
    expect(filterCriteria).not.to.be.null;
    expect(filterCriteria).to.have.property('index').that.is.a('string');
    expect(filterCriteria).not.to.have.property('type');
    expect(filterCriteria).to.have.property('body')
      .that.is.an('object')
      .that.deep.equals({ // a. this is really 2 tests in one
        // b. no default sort: server-generated ids only exist as `_id`, which
        // Elasticsearch 8+ cannot sort on without fielddata
        query: {
          bool: {
            filter: [{ term: { docType: modelName } }],
            must: [{
              range: {
                order: {
                  gte: 3,
                  lte: 6
                }
              }
            }]
          }
        }
      });
    expect(filterCriteria).to.have.property('size')
      .that.is.a('number');
    expect(filterCriteria).to.have.property('from')
      .that.is.a('number');

    done();
  });

  it('should build a "and" and "between" query for the WHERE filter', function(done) {
    var criteria, size, offset, modelName, modelIdName, settings, mappingType;
    criteria = {
      where: {
        and: [
          { order: { between: [2, 6] } },
          { vip: true }
        ]
      }
    };
    size = 100;
    offset = 10;
    modelName = 'MockLoopbackModel';
    modelIdName = 'id';
    settings = getSettings();
    mappingType = settings.mappingType;

    var filterCriteria = testConnector.buildFilter(modelName, modelIdName, criteria, size, offset);
    expect(filterCriteria).not.to.be.null;
    expect(filterCriteria).to.have.property('index').that.is.a('string');
    expect(filterCriteria).not.to.have.property('type');
    expect(filterCriteria).to.have.property('body')
      .that.is.an('object')
      .that.deep.equals({ // a. this is really 2 tests in one
        // b. no default sort: server-generated ids only exist as `_id`, which
        // Elasticsearch 8+ cannot sort on without fielddata
        query: {
          bool: {
            filter: [{ term: { docType: modelName } }],
            must: [{
                range: {
                  order: {
                    gte: 2,
                    lte: 6
                  }
                }
              },
              {
                match: {
                  vip: true
                }
              }
            ]
          }
        }
      });
    expect(filterCriteria).to.have.property('size')
      .that.is.a('number');
    expect(filterCriteria).to.have.property('from')
      .that.is.a('number');

    done();
  });

  it('should build multiple normal where clause query without "and" for the WHERE filter', function(done) {
    var criteria, size, offset, modelName, modelIdName, settings, mappingType;
    criteria = {
      where: {
        role: 'lead',
        vip: true
      }
    };
    size = 100;
    offset = 10;
    modelName = 'MockLoopbackModel';
    modelIdName = 'id';
    settings = getSettings();
    mappingType = settings.mappingType;

    var filterCriteria = testConnector.buildFilter(modelName, modelIdName, criteria, size, offset);
    expect(filterCriteria).not.to.be.null;
    expect(filterCriteria).to.have.property('index').that.is.a('string');
    expect(filterCriteria).not.to.have.property('type');
    expect(filterCriteria).to.have.property('body')
      .that.is.an('object')
      .that.deep.equals({ // a. this is really 2 tests in one
        // b. no default sort: server-generated ids only exist as `_id`, which
        // Elasticsearch 8+ cannot sort on without fielddata
        query: {
          bool: {
            filter: [{ term: { docType: modelName } }],
            must: [{
                match: {
                  role: 'lead'
                }
              },
              {
                match: {
                  vip: true
                }
              }
            ]
          }
        }
      });
    expect(filterCriteria).to.have.property('size')
      .that.is.a('number');
    expect(filterCriteria).to.have.property('from')
      .that.is.a('number');

    done();
  });

  it('should build two "inq" and one "between" without "and" for the WHERE filter', function(done) {
    var criteria, size, offset, modelName, modelIdName, settings, mappingType;
    criteria = {
      where: {
        role: { inq: ['lead'] },
        order: { between: [1, 6] },
        id: { inq: [2, 3, 4, 5] }
      }
    };
    size = 100;
    offset = 10;
    modelName = 'MockLoopbackModel';
    modelIdName = 'id';
    settings = getSettings();
    mappingType = settings.mappingType;

    var filterCriteria = testConnector.buildFilter(modelName, modelIdName, criteria, size, offset);
    expect(filterCriteria).not.to.be.null;
    expect(filterCriteria).to.have.property('index').that.is.a('string');
    expect(filterCriteria).not.to.have.property('type');
    expect(filterCriteria).to.have.property('body')
      .that.is.an('object')
      .that.deep.equals({ // a. this is really 2 tests in one
        // b. no default sort: server-generated ids only exist as `_id`, which
        // Elasticsearch 8+ cannot sort on without fielddata
        query: {
          bool: {
            filter: [{ term: { docType: modelName } }],
            must: [{
                terms: {
                  role: [
                    'lead'
                  ]
                }
              },
              {
                range: {
                  order: {
                    gte: 1,
                    lte: 6
                  }
                }
              },
              {
                terms: {
                  _id: [
                    2,
                    3,
                    4,
                    5
                  ]
                }
              }
            ]
          }
        }
      });
    expect(filterCriteria).to.have.property('size')
      .that.is.a('number');
    expect(filterCriteria).to.have.property('from')
      .that.is.a('number');

    done();
  });

  describe('geo filters', function() {
    var point = { lat: 3.1579, lon: 101.7116 };

    function buildQuery(where, connector) {
      return (connector || testConnector)
        .buildFilter('MockLoopbackModel', 'id', { where: where }, 100, 0).body.query;
    }

    it('should add a top-level "geo_distance" next to the docType filter', function() {
      var geoDistance = { distance: '10km', location: point };
      expect(buildQuery({ location: { geo_distance: geoDistance } })).to.deep.equal({
        bool: {
          filter: [
            { geo_distance: geoDistance },
            { term: { docType: 'MockLoopbackModel' } }
          ]
        }
      });
    });

    it('should add a top-level "geo_bounding_box" next to other conditions', function() {
      var box = { location: { top_left: { lat: 7, lon: 99.5 }, bottom_right: { lat: 1.5, lon: 104.5 } } };
      expect(buildQuery({ name: 'klcc', location: { geo_bounding_box: box } })).to.deep.equal({
        bool: {
          must: [{ match: { name: 'klcc' } }],
          filter: [
            { geo_bounding_box: box },
            { term: { docType: 'MockLoopbackModel' } }
          ]
        }
      });
    });

    it('should wrap a "geo_shape" inside "and" in its own bool filter', function() {
      var shape = {
        area: {
          shape: { type: 'envelope', coordinates: [[103.75, 1.4], [103.95, 1.2]] },
          relation: 'intersects'
        }
      };
      expect(buildQuery({ and: [{ role: 'lead' }, { area: { geo_shape: shape } }] })).to.deep.equal({
        bool: {
          must: [
            { match: { role: 'lead' } },
            { bool: { filter: [{ geo_shape: shape }] } }
          ],
          filter: [{ term: { docType: 'MockLoopbackModel' } }]
        }
      });
    });

    it('should wrap a geo filter on a nested field in a "nested" query', function() {
      var settings = getSettings();
      settings.log = 'error';
      settings.mappingProperties.branches = {
        type: 'nested',
        properties: { location: { type: 'geo_point' } }
      };
      var datasource = getDataSource(settings);
      datasource.define('MockLoopbackModel', { id: { type: String, generated: true, id: true } });
      var connector = datasource.connector;
      var geoDistance = { distance: '10km', 'branches.location': point };
      expect(buildQuery({ 'branches.location': { geo_distance: geoDistance } }, connector)).to.deep.equal({
        bool: {
          must: [{
            nested: {
              path: 'branches',
              score_mode: 'max',
              query: { bool: { filter: [{ geo_distance: geoDistance }] } }
            }
          }],
          filter: [{ term: { docType: 'MockLoopbackModel' } }]
        }
      });
    });
  });
});
