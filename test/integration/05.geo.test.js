/*global getSettings getDataSource expect*/
/*eslint no-console: ["error", { allow: ["trace","log"] }] */
// Geo filters against a running server. The `location` (geo_point) and
// `area` (geo_shape) fields are mapped in datasource-test-plain.json.
describe('Geo filters', function() {
  var db, Place;

  // A square of `halfSide` degrees around a point, as a GeoJSON envelope.
  function envelope(lat, lon, halfSide) {
    return {
      type: 'envelope',
      coordinates: [[lon - halfSide, lat + halfSide], [lon + halfSide, lat - halfSide]]
    };
  }

  var places = [
    // Kuala Lumpur city centre
    { name: 'klcc', location: { lat: 3.1579, lon: 101.7116 }, area: envelope(3.1579, 101.7116, 0.01) },
    // about 9.5 km north of KLCC
    { name: 'batu-caves', location: { lat: 3.2379, lon: 101.6840 }, area: envelope(3.2379, 101.6840, 0.01) },
    // Singapore, about 300 km away
    { name: 'marina-bay', location: { lat: 1.2834, lon: 103.8607 }, area: envelope(1.2834, 103.8607, 0.01) }
  ];

  function names(results) {
    return results.map(function(p) { return p.name; }).sort();
  }

  before(function(done) {
    require('./init.js');
    var settings = getSettings();
    settings.log = 'error';
    db = getDataSource(settings);
    Place = db.define('GeoPlace', {
      name: { type: String },
      location: { type: Object },
      area: { type: Object }
    });
    db.connect(function(err) {
      if (err) { return done(err); }
      Place.destroyAll(function(err) {
        if (err) { return done(err); }
        Place.create(places, done);
      });
    });
  });

  after(function(done) {
    Place.destroyAll(done);
  });

  it('finds places within a distance with geo_distance', function() {
    return Place.find({
      where: {
        location: { geo_distance: { distance: '5km', location: { lat: 3.1579, lon: 101.7116 } } }
      }
    }).then(function(results) {
      expect(names(results)).to.deep.equal(['klcc']);
      return Place.find({
        where: {
          location: { geo_distance: { distance: '15km', location: { lat: 3.1579, lon: 101.7116 } } }
        }
      });
    }).then(function(results) {
      expect(names(results)).to.deep.equal(['batu-caves', 'klcc']);
    });
  });

  it('finds places inside a box with geo_bounding_box', function() {
    return Place.find({
      where: {
        location: {
          geo_bounding_box: {
            location: { top_left: { lat: 7, lon: 99.5 }, bottom_right: { lat: 1.5, lon: 104.5 } }
          }
        }
      }
    }).then(function(results) {
      expect(names(results)).to.deep.equal(['batu-caves', 'klcc']);
    });
  });

  it('finds places whose shape intersects another with geo_shape', function() {
    return Place.find({
      where: {
        area: {
          geo_shape: {
            area: { shape: envelope(1.3, 103.85, 0.1), relation: 'intersects' }
          }
        }
      }
    }).then(function(results) {
      expect(names(results)).to.deep.equal(['marina-bay']);
    });
  });

  it('combines a geo filter with other conditions', function() {
    return Place.find({
      where: {
        and: [
          { name: { neq: 'klcc' } },
          { location: { geo_distance: { distance: '15km', location: { lat: 3.1579, lon: 101.7116 } } } }
        ]
      }
    }).then(function(results) {
      expect(names(results)).to.deep.equal(['batu-caves']);
    });
  });

  it('only returns documents of the queried model', function() {
    var Other = db.define('GeoOther', { name: { type: String }, location: { type: Object } });
    return Other.create({ name: 'other-klcc', location: { lat: 3.1579, lon: 101.7116 } })
      .then(function() {
        return Place.find({
          where: {
            location: { geo_distance: { distance: '5km', location: { lat: 3.1579, lon: 101.7116 } } }
          }
        });
      })
      .then(function(results) {
        expect(names(results)).to.deep.equal(['klcc']);
        return Other.destroyAll();
      });
  });
});
