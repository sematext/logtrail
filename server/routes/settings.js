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
      } else if (host.endsWith('.keyword')) {
        settings.host = host.substring(0, host.indexOf('.keyword'));
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
        id: 'logtrail:config',
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
          type: 'logtrail'
        }
      }
      if (raw) {
        updateRequest.body.logtrail.field_mapping['hostname_keyword'] = host;
      }
      const { callWithRequest } = server.plugins.elasticsearch.getCluster('data');
      callWithRequest(request, 'index', updateRequest).then(function (resp) {
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
        console.error('Cannot find App Token in request.')
        reply({
          ok: false,
          message: 'Cannot find App Token in the request'
        });
        return;
      }

      var fieldCapsRequest = {
        index: index + '_*',
        fields: '*',
        ignoreUnavailable: true,
        allowNoIndices: false
      }
      const { callWithRequest } = server.plugins.elasticsearch.getCluster('data');
      callWithRequest(request, 'fieldCaps',fieldCapsRequest).then(function (resp) {
        var fieldsToReturn = [];
        var fieldsToIgnore = ['@timestamp', '@timestamp_received', 'message', 'message.keyword', 'message.raw', 'logsene_original_type'];
        for (var field in resp.fields) {
          for (var type in resp.fields[field]) {
            if (!type.startsWith('_') && !fieldsToIgnore.includes(field) ) {
              const f = {
                name : field,
                keyword: type === 'keyword'
              }
              fieldsToReturn.push(f);
            }
          }
        }
        reply({
          ok: true,
          fields: fieldsToReturn
        });
        return;
      }).catch(function (resp) {
        console.error('Error while fetching fields ', resp)
        reply({
          ok: false,
          message: 'Cannot fetch settings info'
        });
        return;
      });
    }
  });

  server.route({
    method: 'GET',
    path: '/logtrail/config',
    handler: function (request, reply) {
      var index = null;
      if (request.state.kibana5_token) {
        index = request.state.kibana5_token;
      } else {
        console.error('Cannot find App Token in request.')
        reply({
          ok: false,
          message: 'Cannot find App Token in the request'
        });
        return;
      }
      var getRequest = {
        index: index + '_kibana',
        type: 'doc',
        id: 'logtrail:config'
      };
      const { callWithRequest } = server.plugins.elasticsearch.getCluster('data');
      callWithRequest(request, 'get',getRequest).then(function (resp) {
        if (resp.found) {
          var configFromES = resp._source;
          var config = require('../../logtrail.json');
          var indexConfig = config.index_patterns[0];
          indexConfig.es.default_index = index;
          indexConfig.fields = configFromES.logtrail.field_mapping;
          indexConfig.color_mapping = configFromES.logtrail.color_mapping;
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
        console.error('Error while fetching config ', resp)
        reply({
          ok: false,
          message: 'Cannot fetch logtrail configuration.'
        });
      });
    }
  });
}