var utils = require('./utils.js');

// Save settings
module.exports = function (server) {
  server.route({
    method: 'POST',
    path: '/logtrail/settings',
    handler: function (request, reply) {
      var settings = request.payload;
      var host = settings.host;
      var raw = false;
      if (host.endsWith('.raw')) {
        settings.host = host.substring(0, host.indexOf('.raw'));
        raw = true;
      }
      //verify template
      var handlebar = require('handlebars');
      try {
        handlebar.precompile(settings.messageFormat);
      } catch(e) {
        reply({
          ok: false,
          message: 'Invalid message format - ' + e.message
        });
        return;
      }
      var updateRequest = {
        index: request.state.kibana5_token + '_kibana',
        type: 'doc',
        id: 'config:logtrail',
        body: {
          logtrail: {
            field_mapping: {
              mapping: {
                timestamp: '@timestamp',
                hostname: settings.host,
                program: settings.program,
                message: 'message',
              },
              message_format: settings.messageFormat
            }
          },
          type: 'logtrail',
        }
      };
      if (raw) {
        updateRequest.body.logtrail.field_mapping.hostname_keyword = host;
      }
      const { callWithRequest } = server.plugins.elasticsearch.getCluster('data');
      callWithRequest(request, 'index',updateRequest).then(function (resp) {
        reply({
          ok: true
        });
      }).catch(function (resp) {
        reply({
          ok: false,
          message: resp
        });
      });
    }
  });

  server.route({
    method: 'GET',
    path: '/logtrail/settings',
    handler: async function (request, reply) {
      var index = null;
      if (request.state.kibana5_token) {
        index = request.state.kibana5_token;
      } else {
        console.error('Cannot find App Token in request.');
        reply({
          ok: false,
          message: 'Cannot find App Token in the request'
        });
        return;
      }

      var indicesToSearch = await utils.getIndicesToSearch(index, '@timestamp', null, request, server);
      if (indicesToSearch.length > 0) {
        var latestIndex = indicesToSearch[0];
        var mappingRequest = {
          index: latestIndex
        };
        const { callWithRequest } = server.plugins.elasticsearch.getCluster('data');
        callWithRequest(request, 'indices.getMapping',mappingRequest).then(function (resp) {
          for (var index in resp) {
            var properties = resp[index].mappings['logsene_type'].properties;
            //Known mappings
            var ignoreFields = ['@timestamp','@timestamp_received','message','logsene_original_type'];
            var fields = [];
            getFieldMappings (properties, fields, ignoreFields, null);
            reply({
              ok: true,
              fields: fields
            });
            return;
          }
        }).catch(function (resp) {
          console.error('Error while fetching fields ', resp);
          reply({
            ok: false,
            message: 'Cannot fetch settings info'
          });
          return;
        });
      }
    }
  });

  function getFieldMappings(properties, fieldsArray, ignoreFields, parentField) {
    for (var p in properties) {
      var name = p;
      if (parentField) {
        name = parentField + '.' + p;
      }
      if (ignoreFields.indexOf(p) === -1) {
        //nested
        if (properties[p].properties) {
          getFieldMappings(properties[p].properties, fieldsArray, ignoreFields,name);
        } else {
          var field = {
            name: name,
            type: properties[p].type
          };

          if (properties[p].fields) {
            if (properties[p].fields.raw) {
              field.rawType = properties[p].fields.raw.type;
            }
          }
          fieldsArray.push(field);
        }
      }
    }
  }

  server.route({
    method: 'GET',
    path: '/logtrail/config',
    handler: function (request, reply) {
      var index = null;
      if (request.state.kibana5_token) {
        index = request.state.kibana5_token;
      } else {
        console.error('Cannot find App Token in request.');
        reply({
          ok: false,
          message: 'Cannot find App Token in the request'
        });
        return;
      }
      var getRequest = {
        index: index + '_kibana',
        type: 'doc',
        id: 'config:logtrail'
      };
      const { callWithRequest } = server.plugins.elasticsearch.getCluster('data');
      callWithRequest(request, 'get',getRequest).then(function (resp) {
        if (resp.found) {
          var configFromES = resp._source.logtrail;
          var config = require('../../logtrail.json');
          var indexConfig = config.index_patterns[0];
          indexConfig.es.default_index = index;
          indexConfig.fields = configFromES.field_mapping;
          indexConfig.color_mapping = configFromES.color_mapping;
          reply({
            ok: true,
            config: config
          });
        } else {
          reply({
            ok: false,
            notFound: true,
            message: 'Cannot find logtrail configuration'
          });
        }
      }).catch(function (resp) {
        console.error('Error while fetching config ', resp);
        reply({
          ok: false,
          message: 'Cannot fetch logtrail configuration.'
        });
      });
    }
  });
};