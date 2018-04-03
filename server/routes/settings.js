var utils = require('./utils.js');

module.exports = function (server) {
  server.route({
    method: "POST",
    path: '/logtrail/settings',
    handler: function (request, reply) {
      var settings = request.payload;
      var host = settings.host;
      var raw = false;
      if (host.endsWith('.raw')) {
        settings.host = host.substring(0, host.indexOf('.raw'));
        raw = true;
      }
      var updateRequest = {
        index: request.state.kibana5_token + "_kibana",
        type: 'logtrail',
        id: 'config',
        body: {
            default_time_range_in_days: settings.timeRange,
            field_mapping: {
              mapping: {
                timestamp: '@timestamp',
                hostname: settings.host,
                program: settings.program,
                message: 'message',
              },
              message_format: settings.messageFormat
          }
        }
      }
      if (raw) {
        updateRequest.body.field_mapping['hostname_keyword'] = host;
      }
      const { callWithInternalUser } = server.plugins.elasticsearch.getCluster('admin');
      callWithInternalUser('index',updateRequest).then(function (resp) {
        reply({
          ok: true
        });
      }).catch(function (resp) {
        reply({
          ok: false
        });
      });
    }
  });

  server.route({
    method: "GET",
    path: '/logtrail/settings',
    handler: async function (request, reply) {
      var index = null;
      if (request.state.kibana5_token) {
        index = request.state.kibana5_token;
      } else {
        console.error("Cannot find App Token in request.")
        reply({
          ok: false,
          message: "Cannot find App Token in the request"
        });
        return;
      }

      var indicesToSearch = await utils.getIndicesToSearch(index, "@timestamp", null, request, server);
      if (indicesToSearch.length > 0) {
        var latestIndex = indicesToSearch[0];
        var mappingRequest = {
          index: latestIndex
        }
        const { callWithInternalUser } = server.plugins.elasticsearch.getCluster('admin');
        callWithInternalUser('indices.getMapping',mappingRequest).then(function (resp) {
          for (var index in resp) {
            var properties = resp[index].mappings["logsene_type"].properties;
            //Known mappings
            var knownFields = ["@timestamp","@timestamp_received","message","logsene_original_type"];
            var fields = [];
            for (var p in properties) {
              if (knownFields.indexOf(p) === -1) {
                var field = {
                  name: p,
                  type: properties[p].type
                }

                if (properties[p].fields) {
                  if (properties[p].fields.raw) {
                    field.rawType = properties[p].fields.raw.type
                  }
                }
                fields.push(field);
              }
            }
            reply({
              ok: true,
              fields: fields
            });
            return;
          }
        }).catch(function (resp) {
          console.error("Error while fetching fields ", resp)
          reply({
            ok: false,
            message: "Cannot fetch settings info"
          });
          return;
        });
      }
    }
  });

  server.route({
    method: 'GET',
    path: '/logtrail/config',
    handler: function (request, reply) {
      //SEMATEXT BEGIN - The config fetch is customized for Sematext installation
      // Look for config object (contains only field_mapping and color_mapping) in <index>_kibana/logtral/config id
      // If found, merge the config object (index, fields and color mapping) with logtrail.json from local file system
      var index = null;
      if (request.state.kibana5_token) {
        index = request.state.kibana5_token;
      } else {
        console.error("Cannot find App Token in request.")
        reply({
          ok: false,
          message: "Cannot find App Token in the request"
        });
        return;
      }
      var getRequest = {
        index: index + '_kibana',
        type: 'logtrail',
        id: 'config'
      };
      const { callWithInternalUser } = server.plugins.elasticsearch.getCluster('admin');
      callWithInternalUser('get',getRequest).then(function (resp) {
        if (resp.found) {
          var configFromES = resp._source;
          var config = require('../../logtrail.json');
          var indexConfig = config.index_patterns[0];
          indexConfig.es.default_index = index;
          indexConfig.fields = configFromES.field_mapping;
          indexConfig.color_mapping = configFromES.color_mapping;
          if (configFromES.default_time_range_in_days) {
            indexConfig.default_time_range_in_days = configFromES.default_time_range_in_days;
          }
          reply({
            ok: true,
            config: config
          });
        } else {
          reply({
            ok: false,
            notFound: true,
            message: "Cannot find logtrail configuration"
          });
        }
      }).catch(function (resp) {
        console.error("Error while fetching config ", resp)
        reply({
          ok: false,
          message: "Cannot fetch logtrail configuration."
        });
      });
    }
    //SEMATEXT END
  });
}