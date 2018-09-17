var utils = require('./utils.js');

function getMessageTemplate(handlebar, selectedConfig) {
  var messageFormat = selectedConfig.fields.message_format;
  //Append <a> tags for click to message format except for message field
  var messageFormatRegex = /({{{[\[]?(\S+?)[\]]?}}})/g; // e.g. {{{[pid]}}} {{{program-name}}} : {{syslog_message}}
  var ngClickTemplate = handlebar.compile('<a class="ng-binding" ng-click="onClick(\'{{name_no_braces}}\',\'{{name}}\')">{{name}}</a>',
    {
      knownHelpers: {
        log: false,
        lookup: false
      },
      knownHelpersOnly: true
    });
  var messageField = selectedConfig.fields.mapping.message;
  var messageTemplate = messageFormat;

  var match = messageFormatRegex.exec(messageFormat);
  while (match !== null) {
    if (match[2] !== messageField) {
      var context = {
        name : match[0],
        name_no_braces : match[2]
      };
      var messageWithClickAttr = ngClickTemplate(context);
      messageTemplate = messageTemplate.replace(match[0], messageWithClickAttr);
    }
    match = messageFormatRegex.exec(messageFormat);
  }
  return messageTemplate; //<a class="ng-binding" ng-click="onClick('pid','{{pid}}')">{{pid}}</a> : {{syslog_message}}
}

function convertToClientFormat(selectedConfig, esResponse) {
  var clientResponse = [];
  var hits = esResponse.hits.hits;
  var template = null;
  var messageFormat = selectedConfig.fields.message_format;
  if (messageFormat) {
    var handlebar = require('handlebars');
    var messageTemplate = getMessageTemplate(handlebar, selectedConfig);
    template = handlebar.compile(messageTemplate, {
      knownHelpers: {
        log: false,
        lookup: false
      },
      knownHelpersOnly: true
    });
  }
  for (let i = 0; i < hits.length; i++) {
    var event = {};
    var source =  hits[i]._source;
    event.id = hits[i]._id;
    let get = require('lodash.get');
    event.timestamp = get(source, selectedConfig.fields.mapping.timestamp);
    event.hostname = get(source, selectedConfig.fields.mapping.hostname);
    event.program = get(source, selectedConfig.fields.mapping.program);

    //Calculate message color, if configured
    if (selectedConfig.color_mapping && selectedConfig.color_mapping.field) {
      var colorField = get(source, selectedConfig.color_mapping.field);
      var color = selectedConfig.color_mapping.mapping[colorField];
      if (color) {
        event.color =  color;
      }
    }

    //Change the source['message'] to highlighter text if available
    if (hits[i].highlight) {
      var set = require('lodash.set');
      var withHighlights = get(hits[i].highlight, [selectedConfig.fields.mapping.message,0]);
      set(source, selectedConfig.fields.mapping.message, withHighlights);
      source[selectedConfig.fields.mapping.message] = hits[i].highlight[selectedConfig.fields.mapping.message][0];
    }
    var message = source[selectedConfig.fields.mapping.message];
    //sanitize html
    var escape = require('lodash.escape');
    message = escape(message);
    //if highlight is present then replace pre and post tag with html
    if (hits[i].highlight) {
      message = message.replace(/logtrail.highlight.pre_tag/g,'<span class="highlight">');
      message = message.replace(/logtrail.highlight.post_tag/g,'</span>');
    }
    source[selectedConfig.fields.mapping.message] = message;

    //If the user has specified a custom format for message field
    if (messageFormat) {
      event.message = template(source);
    } else {
      event.message = message;
    }
    clientResponse.push(event);
  }
  return clientResponse;
}

function getDefaultTimeRangeToSearch(selectedConfig) {
  var defaultTimeRangeToSearch = null;
  var moment = require('moment');
  if (selectedConfig.default_time_range_in_minutes && 
    selectedConfig.default_time_range_in_minutes !== 0) {
    defaultTimeRangeToSearch = moment().subtract(
      selectedConfig.default_time_range_in_minutes,'minutes').valueOf();
  } else if (selectedConfig.default_time_range_in_days !== 0) {
    defaultTimeRangeToSearch = moment().subtract(
      selectedConfig.default_time_range_in_days,'days').startOf('day').valueOf();
  }
  return defaultTimeRangeToSearch;
}

module.exports = function (server) {

  //Search
  server.route({
    method: ['POST'],
    path: '/logtrail/search',
    handler: async function (request, reply) {
      const { callWithRequest } = server.plugins.elasticsearch.getCluster('data');
      var selectedConfig = request.payload.config;
      var searchText = request.payload.searchText;

      if (searchText == null || searchText.length === 0) {
        searchText = '*';
      }
      //If no time range is present get events based on default selected_config
      var timestamp = request.payload.timestamp;
      var rangeType = request.payload.rangeType;
      if (timestamp == null) {
          timestamp = getDefaultTimeRangeToSearch(selectedConfig,searchText);
          rangeType = 'gte';
      }
      var fieldStatsTimestamp = timestamp;
      if (rangeType === 'lte') { //scroll up
        fieldStatsTimestamp = getDefaultTimeRangeToSearch(selectedConfig,searchText);
      }

      /*var indicesToSearch = await utils.getIndicesToSearch(selectedConfig.es.default_index, 
        selectedConfig.fields.mapping.timestamp, fieldStatsTimestamp, request, server);
      
      if (!indicesToSearch || indicesToSearch.length === 0) {
        server.log(['logtrail','info'],"Empty indices to search for timestamp "+ timestamp + " with index " + selectedConfig.es.default_index);
        //return empty array
        reply({
          ok: true,
          resp: []
        });
        return;
      }*/

      //Search Request body
      var searchRequest = {
        index: selectedConfig.es.default_index,
        size: selectedConfig.max_buckets,
        body : {
          sort : [{}],
          query : {
              bool : {
                must :{
                    query_string : {
                      analyze_wildcard: true,
                      default_field : selectedConfig.fields.mapping['message'],
                      query : searchText,
                      default_operator: 'AND'
                    }
                },
                filter: {
                  bool : {
                    must : [
                    ],
	                  must_not:[],
                  }
                }
              }
            }
        }
      };

      if (searchText !== "*") {
        searchRequest.body['highlight'] = {
          pre_tags : ["logtrail.highlight.pre_tag"],
          post_tags : ["logtrail.highlight.post_tag"],
          fields : {
          }
        };
        //Enable highlightng on message field
        searchRequest.body.highlight.fields[selectedConfig.fields.mapping['message']] = {
          number_of_fragments: 0
        };
      }

      //By default Set sorting column to timestamp
      searchRequest.body.sort[0][selectedConfig.fields.mapping.timestamp] = {'order':request.payload.order ,'unmapped_type': 'boolean'};

      //If hostname is present then term query.
      if (request.payload.hostname != null) {
        var termQuery = {
          term : {
          }
        };
        var hostnameField = selectedConfig.fields.mapping.hostname;
        if (selectedConfig.fields['hostname_keyword']) {
          hostnameField += '.raw';
        }
        termQuery.term[hostnameField] = request.payload.hostname;
        searchRequest.body.query.bool.filter.bool.must.push(termQuery);
      }
      //If timestamps are present set ranges
      if (timestamp != null) {
        var rangeQuery = {
          range : {

          }
        };
        var range = rangeQuery.range;
        range[selectedConfig.fields.mapping.timestamp] = {};
        range[selectedConfig.fields.mapping.timestamp][rangeType] = timestamp;
        range[selectedConfig.fields.mapping.timestamp].format = 'epoch_millis';
        searchRequest.body.query.bool.filter.bool.must.push(rangeQuery);
      }
      //console.log(JSON.stringify(searchRequest));

      callWithRequest(request,'search',searchRequest).then(function (resp) {
        reply({
          ok: true,
          resp: convertToClientFormat(selectedConfig, resp)
        });
      }).catch(function (resp) {
        server.log(['logtrail','error'],"Error while executing search" + resp);
        if (resp.isBoom) {
          reply(resp);
        } else {
          console.error('Error while executing search',resp);
          reply({
            ok: false,
            resp: resp
          });
        }
      });
    }
  });

  //Get All Systems
  server.route({
    method: ['POST'],
    path: '/logtrail/hosts',
    handler: async function (request,reply) {
      const { callWithRequest } = server.plugins.elasticsearch.getCluster('data');
      var selectedConfig = request.payload.config;
      var index = request.payload.index;
      var timestamp = request.payload.timestamp;
      var moment = require('moment');
      /*var indicesToSearch = await utils.getIndicesToSearch(selectedConfig.es.default_index, 
        selectedConfig.fields.mapping.timestamp, timestamp, request, server);
      if (!indicesToSearch || indicesToSearch.length === 0) {
        server.log(['logtrail','info'],"Empty indices to search for timestamp "+ timestamp + " with index " + selectedConfig.es.default_index);
        reply({
          ok: true,
          resp: []
        });
        return;
      }*/

      var hostnameField = selectedConfig.fields.mapping.hostname;
      if (selectedConfig.fields['hostname_keyword']) {
        hostnameField += '.raw';
      }
      var hostAggRequest = {
        index: selectedConfig.es.default_index,
        body : {
          size: 0,
          aggs: {
            hosts: {
              terms: {
                field: hostnameField,
                size: selectedConfig.max_hosts
              }
            }
          }
        }
      };
      //console.log(JSON.stringify(hostAggRequest));
      callWithRequest(request,'search',hostAggRequest).then(function (resp) {
      //console.log(JSON.stringify(resp));//.aggregations.hosts.buckets);
        reply({
          ok: true,
          resp: resp.aggregations.hosts.buckets
        });
      }).catch(function (resp) {
        server.log(['logtrail','error'],"Error while fetching hosts" + resp);
        if(resp.isBoom) {
          reply(resp);
        } else {
          console.error('Error while fetching hosts',resp);
          reply({
            ok: false,
            resp: resp
          });
        }
      });
    }
  });
};
